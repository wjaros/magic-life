// Host side of remote play. The table device stays authoritative: remote requests are
// validated here, then dispatched through the normal store `act()` (so undo and the merge
// window behave as for local taps). The relay only forwards.
import { effect, signal, type ReadonlySignal } from '@preact/signals';
import type { Action, GameState, PlayerId } from '../core/types';
import { act as storeAct, history, undoAct as storeUndo } from '../ui/store';
import { connect, relayAvailable, relayUrl, type ConnStatus, type Connection, type ConnectOptions } from './connection';
import type { ClientId, HostToServer, RemoteToServer, Seats, ServerToHost } from './protocol';

export const HOST_STORAGE_KEY = 'magic-life/host';
/** Max state frames per second. The latest state is always sent (trailing edge). */
export const STATE_MIN_INTERVAL_MS = 100;

export interface Peer {
  name?: string;
  online: boolean;
}

type RefuseReason = 'seat-taken' | 'not-your-player' | 'not-allowed';

type HostConnection = Connection<ServerToHost, HostToServer>;
export type ConnectFn = (opts: ConnectOptions<HostToServer>) => HostConnection;

interface Stored {
  room?: string;
  token?: string;
  seats?: Seats;
}

function loadStored(): Stored {
  try {
    const raw = localStorage.getItem(HOST_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Stored) : {};
  } catch {
    return {};
  }
}
function saveStored(s: Stored | null): void {
  try {
    if (s) localStorage.setItem(HOST_STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(HOST_STORAGE_KEY);
  } catch { /* storage unavailable: hosting still works for this session */ }
}

// ---------- permission rules (pure) ----------

/** Actions whose `playerId` must be the claimed seat. */
const OWN_PLAYER_ACTIONS = new Set<Action['type']>([
  'adjustLife', 'adjustPoison', 'adjustEnergy', 'adjustExperience', 'adjustCommanderCasts',
  'adjustCustomCounter', 'setPinned', 'addCustomCounter', 'renameCustomCounter',
  'removeCustomCounter', 'setConceded', 'renamePlayer', 'setColor', 'rotatePlayer',
]);

/** Shape check for untrusted JSON: only primitives and short string arrays, bounded sizes. */
function sane(a: unknown): a is Action {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
  const o = a as Record<string, unknown>;
  if (typeof o.type !== 'string') return false;
  for (const v of Object.values(o)) {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return false;
    } else if (typeof v === 'string') {
      if (v.length > 64) return false;
    } else if (Array.isArray(v)) {
      if (v.length > 8 || !v.every((x) => typeof x === 'string' && x.length <= 64)) return false;
    } else if (v !== null && typeof v !== 'boolean') return false;
  }
  return true;
}

export type Verdict = { ok: true; action: Action } | { ok: false; reason: RefuseReason };

/** Decide whether `seat` may perform `raw`; on success returns the action with `now` replaced. */
export function authorize(raw: unknown, seat: PlayerId | null, state: GameState, now: number): Verdict {
  if (!seat) return { ok: false, reason: 'not-your-player' };
  if (!sane(raw)) return { ok: false, reason: 'not-allowed' };
  const a = raw;
  const mine = { ok: true, action: a } as const;
  const other = { ok: false, reason: 'not-your-player' } as const;
  const denied = { ok: false, reason: 'not-allowed' } as const;
  let res: Verdict;
  if (OWN_PLAYER_ACTIONS.has(a.type)) {
    res = (a as { playerId?: string }).playerId === seat ? mine : other;
  } else {
    switch (a.type) {
      case 'adjustCommanderDamage':
        res = a.targetId === seat ? mine : other;
        break;
      case 'setMonarch':
      case 'setInitiative':
        res = a.playerId === null || a.playerId === seat ? mine : other;
        break;
      case 'clockStart':
      case 'clockPause':
        res = mine;
        break;
      case 'clockNextTurn':
        res = state.clock.activePlayerId === seat ? mine : other;
        break;
      default:
        res = denied;
    }
  }
  if (!res.ok) return res;
  const action = { ...res.action } as Action;
  if ('now' in action) (action as { now: number }).now = now;
  return { ok: true, action };
}

// ---------- host controller ----------

export interface HostDeps {
  connect: ConnectFn;
  act: (a: Action) => void;
  undo: () => void;
  now: () => number;
}

export function createHost(deps: HostDeps) {
  const hosting = signal(false);
  const room = signal<string | null>(null);
  const seats = signal<Seats>({});
  const peers = signal<Map<ClientId, Peer>>(new Map());
  const status = signal<ConnStatus>('closed');
  const relay = signal(false);

  let conn: HostConnection | null = null;
  let offMsg: (() => void) | null = null;
  let stopStatus: (() => void) | null = null;
  let stopSend: (() => void) | null = null;
  let stopAuthors: (() => void) | null = null;
  let record: Stored = {};
  let lastSent = 0;
  let sendTimer: ReturnType<typeof setTimeout> | undefined;

  // Author of each history.past entry (seat id, or null for local/unknown). Aligned with
  // history.past by length reconciliation. Limits: a window-merged entry keeps its first
  // author; redo'd entries have no author; once past reaches HISTORY_CAP the alignment is
  // kept by a top-of-stack identity check.
  let authors: (PlayerId | null)[] = [];
  let lastTop: GameState | undefined;
  let pendingAuthor: PlayerId | null = null;

  const reconcileAuthors = () => {
    const h = history.value;
    const past = h?.past ?? [];
    const top = past[past.length - 1];
    if (past.length > authors.length) {
      for (let i = authors.length; i < past.length; i++) authors.push(pendingAuthor);
    } else if (past.length < authors.length) {
      authors.length = past.length;
    } else if (top !== lastTop && past.length > 0) {
      authors.shift();
      authors.push(pendingAuthor);
    }
    lastTop = top;
  };

  const cleanSeats = (s: Seats, state: GameState | undefined): Seats => {
    const out: Seats = {};
    for (const p of state?.players ?? []) out[p.id] = s[p.id] ?? null;
    return out;
  };

  const sendNow = () => {
    clearTimeout(sendTimer);
    sendTimer = undefined;
    const state = history.peek()?.present;
    if (!conn || !state) return;
    lastSent = deps.now();
    conn.send({ t: 'state', state, seats: seats.peek(), hostNow: deps.now() });
  };
  const scheduleSend = () => {
    if (sendTimer !== undefined) return;
    const wait = lastSent + STATE_MIN_INTERVAL_MS - deps.now();
    if (wait <= 0) sendNow();
    else sendTimer = setTimeout(sendNow, wait);
  };

  const setSeats = (next: Seats) => {
    seats.value = next;
    record = { ...record, seats: next };
    saveStored(record);
  };

  const refuse = (clientId: ClientId, reason: RefuseReason) =>
    conn?.send({ t: 'toRemote', clientId, msg: { t: 'refused', reason } });

  const seatOf = (clientId: ClientId): PlayerId | null => {
    for (const [pid, cid] of Object.entries(seats.peek())) if (cid === clientId) return pid;
    return null;
  };

  function onRemote(clientId: ClientId, msg: RemoteToServer): void {
    const state = history.peek()?.present;
    if (!state || !msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'claim': {
        if (!state.players.some((p) => p.id === msg.playerId)) return refuse(clientId, 'not-your-player');
        const cur = seats.peek();
        const holder = cur[msg.playerId];
        if (holder && holder !== clientId) return refuse(clientId, 'seat-taken');
        const next = cleanSeats(cur, state);
        for (const pid of Object.keys(next)) if (next[pid] === clientId) next[pid] = null;
        next[msg.playerId] = clientId;
        setSeats(next);
        return sendNow();
      }
      case 'release': {
        const pid = seatOf(clientId);
        if (!pid) return;
        setSeats({ ...seats.peek(), [pid]: null });
        return sendNow();
      }
      case 'action': {
        const seat = seatOf(clientId);
        const v = authorize(msg.action, seat, state, deps.now());
        if (!v.ok) return refuse(clientId, v.reason);
        pendingAuthor = seat;
        try {
          deps.act(v.action);
        } finally {
          pendingAuthor = null;
        }
        return;
      }
      case 'undo': {
        const seat = seatOf(clientId);
        if (!seat) return refuse(clientId, 'not-your-player');
        if (authors.length === 0 || authors[authors.length - 1] !== seat) return refuse(clientId, 'not-allowed');
        deps.undo();
        return;
      }
      default:
        return; // join/ping are handled by the server
    }
  }

  function onMessage(msg: ServerToHost): void {
    switch (msg.t) {
      case 'hosted':
        room.value = msg.room;
        record = { ...record, room: msg.room, token: msg.token };
        saveStored(record);
        sendNow();
        return;
      case 'peer': {
        const next = new Map(peers.peek());
        if (msg.event === 'join') {
          next.set(msg.clientId, { name: msg.name ?? next.get(msg.clientId)?.name, online: true });
        } else {
          const p = next.get(msg.clientId);
          if (p) next.set(msg.clientId, { ...p, online: false });
        }
        peers.value = next;
        if (msg.event === 'join') sendNow();
        return;
      }
      case 'fromRemote':
        return onRemote(msg.clientId, msg.msg);
      case 'error':
        if (msg.code === 'bad-token') {
          // Server knows this code under another token: abandon it and open a fresh room.
          record = { seats: record.seats };
          saveStored(record);
          room.value = null;
          reopen();
        }
        return;
      default:
        return;
    }
  }

  function open(): void {
    conn = deps.connect({
      url: relayUrl(),
      hello: () => [{ t: 'host', room: record.room, token: record.token }],
    });
    offMsg = conn.onMessage(onMessage);
    const c = conn;
    stopStatus = effect(() => { status.value = c.status.value; });
  }
  function closeConn(): void {
    offMsg?.();
    stopStatus?.();
    conn?.close();
    conn = offMsg = stopStatus = null;
  }
  function reopen(): void {
    closeConn();
    if (hosting.peek()) open();
  }

  function startHosting(): void {
    if (hosting.peek()) return;
    record = loadStored();
    const state = history.peek()?.present;
    seats.value = cleanSeats(record.seats ?? {}, state);
    room.value = record.room ?? null;
    peers.value = new Map();
    authors = new Array(history.peek()?.past.length ?? 0).fill(null);
    lastTop = history.peek()?.past.at(-1);
    hosting.value = true;
    stopAuthors = effect(() => { history.value; reconcileAuthors(); });
    stopSend = effect(() => {
      const state = history.value?.present;
      if (!state) return;
      // Players may have changed (new game): drop seats of players that no longer exist.
      const cleaned = cleanSeats(seats.peek(), state);
      const cur = seats.peek();
      const same = Object.keys(cleaned).length === Object.keys(cur).length &&
        Object.keys(cleaned).every((k) => cleaned[k] === cur[k]);
      if (!same) setSeats(cleaned);
      scheduleSend();
    });
    open();
  }

  function stopHosting(): void {
    if (!hosting.peek()) return;
    hosting.value = false;
    stopSend?.();
    stopAuthors?.();
    stopSend = stopAuthors = null;
    clearTimeout(sendTimer);
    sendTimer = undefined;
    closeConn();
    status.value = 'closed';
    room.value = null;
    peers.value = new Map();
    seats.value = {};
    record = {};
    saveStored(null);
  }

  /** Host-side manual release of a tile. */
  function releaseSeat(playerId: PlayerId): void {
    const cur = seats.peek();
    if (!cur[playerId]) return;
    setSeats({ ...cur, [playerId]: null });
    sendNow();
  }

  /** Resume after a page reload if this device was hosting. */
  function resumeIfStored(): void {
    if (loadStored().room) startHosting();
  }

  return {
    hosting: hosting as ReadonlySignal<boolean>,
    room: room as ReadonlySignal<string | null>,
    seats: seats as ReadonlySignal<Seats>,
    peers: peers as ReadonlySignal<Map<ClientId, Peer>>,
    status: status as ReadonlySignal<ConnStatus>,
    relay: relay as ReadonlySignal<boolean>,
    startHosting,
    stopHosting,
    releaseSeat,
    resumeIfStored,
    /** Checks once whether a relay server answers next to the app. */
    async discoverRelay(): Promise<boolean> {
      relay.value = await relayAvailable();
      if (relay.value) resumeIfStored();
      return relay.value;
    },
  };
}

export const host = createHost({
  connect: (o) => connect<ServerToHost, HostToServer>(o),
  act: storeAct,
  undo: storeUndo,
  now: () => Date.now(),
});

export const { hosting, room, seats, peers, status: hostStatus, relay: relayOffered } = host;
export const startHosting = host.startHosting;
export const stopHosting = host.stopHosting;
