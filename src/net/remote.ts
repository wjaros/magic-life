// Remote (phone) side of remote play: joins a room, claims one player's tile, mirrors the host's
// authoritative state and sends actions. Pure signals + connection.ts; no UI imports.
import { computed, signal, type ReadonlySignal } from '@preact/signals';
import type { Action, GameState, PlayerId } from '../core/types';
import { clientId as deviceClientId, connect, relayUrl, type ConnStatus, type Connection } from './connection';
import type { ErrorCode, RemoteToServer, Seats, ServerToRemote } from './protocol';

export const REMOTE_STORAGE_KEY = 'magic-life/remote';
const NAME_KEY = 'magic-life/remote-name';

export interface StoredRemote {
  room: string;
  seat: PlayerId | null;
  name?: string;
}

export interface RemoteOptions {
  url?: string;
  clientId?: string;
  WebSocketImpl?: typeof WebSocket;
}

export interface Remote {
  status: ReadonlySignal<ConnStatus>;
  /** null until the host has been heard from (then true/false). */
  hostOnline: ReadonlySignal<boolean | null>;
  room: ReadonlySignal<string | null>;
  /** True once the server acknowledged our join on the current socket. */
  joined: ReadonlySignal<boolean>;
  game: ReadonlySignal<GameState | null>;
  seats: ReadonlySignal<Seats>;
  myClientId: string;
  mySeat: ReadonlySignal<PlayerId | null>;
  /** Seat we want (and will re-claim after reconnects). */
  desiredSeat: ReadonlySignal<PlayerId | null>;
  /** hostNow - Date.now() at the last state receipt. */
  clockOffset: ReadonlySignal<number>;
  lastRefused: ReadonlySignal<string | null>;
  error: ReadonlySignal<ErrorCode | null>;
  /** Host wall-clock estimate. */
  hostTime(): number;
  start(room: string, seat?: PlayerId | null, name?: string): void;
  claim(playerId: PlayerId): void;
  release(): void;
  act(action: Action): void;
  undo(): void;
  clearRefused(): void;
  /** Leave the room for good and forget it. */
  leave(): void;
}

function stores(): Storage[] {
  const out: Storage[] = [];
  try { out.push(sessionStorage); } catch { /* ignore */ }
  try { out.push(localStorage); } catch { /* ignore */ }
  return out;
}

export function loadStoredRemote(): StoredRemote | null {
  for (const s of stores()) {
    try {
      const raw = s.getItem(REMOTE_STORAGE_KEY);
      if (!raw) continue;
      const v = JSON.parse(raw) as Partial<StoredRemote>;
      if (v && typeof v.room === 'string') {
        return {
          room: v.room,
          seat: typeof v.seat === 'string' ? v.seat : null,
          name: typeof v.name === 'string' ? v.name : undefined,
        };
      }
    } catch { /* ignore */ }
  }
  return null;
}

function writeStored(v: StoredRemote | null): void {
  for (const s of stores()) {
    try {
      if (v) s.setItem(REMOTE_STORAGE_KEY, JSON.stringify(v));
      else s.removeItem(REMOTE_STORAGE_KEY);
    } catch { /* ignore */ }
  }
}

/** Remembered display name, kept even after leaving a room. */
export function storedName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}
export function saveName(name: string): void {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* ignore */ }
}

export function createRemote(opts: RemoteOptions = {}): Remote {
  const myClientId = opts.clientId ?? deviceClientId();
  const status = signal<ConnStatus>('closed');
  const hostOnline = signal<boolean | null>(null);
  const room = signal<string | null>(null);
  const joined = signal(false);
  const game = signal<GameState | null>(null);
  const seats = signal<Seats>({});
  const desiredSeat = signal<PlayerId | null>(null);
  const clockOffset = signal(0);
  const lastRefused = signal<string | null>(null);
  const error = signal<ErrorCode | null>(null);
  const mySeat = computed<PlayerId | null>(() => {
    for (const [pid, cid] of Object.entries(seats.value)) if (cid === myClientId) return pid;
    return null;
  });

  let conn: Connection<ServerToRemote, RemoteToServer> | null = null;
  let unsub: (() => void) | null = null;
  let unsubStatus: (() => void) | null = null;
  let name: string | undefined;
  let claimSent = false;

  const persist = () => {
    if (room.value) writeStored({ room: room.value, seat: desiredSeat.value, name });
  };
  const send = (m: RemoteToServer) => conn?.send(m);

  const maybeClaim = () => {
    const want = desiredSeat.value;
    if (!conn || !want || claimSent || hostOnline.value === false || !joined.value) return;
    if (mySeat.value === want) return;
    const holder = seats.value[want];
    if (holder && holder !== myClientId) {
      // Taken by someone else: don't ask, fall back to the picker.
      desiredSeat.value = null;
      persist();
      return;
    }
    claimSent = true;
    send({ t: 'claim', playerId: want });
  };

  const onMessage = (msg: ServerToRemote) => {
    switch (msg.t) {
      case 'joined':
        joined.value = true;
        error.value = null;
        claimSent = false;
        maybeClaim();
        break;
      case 'hostStatus':
        hostOnline.value = msg.online;
        if (!msg.online) claimSent = false;
        else maybeClaim();
        break;
      case 'state':
        game.value = msg.state;
        seats.value = msg.seats;
        clockOffset.value = msg.hostNow - Date.now();
        if (mySeat.value && desiredSeat.value !== mySeat.value) {
          desiredSeat.value = mySeat.value;
          persist();
        }
        maybeClaim();
        break;
      case 'refused':
        lastRefused.value = msg.reason;
        claimSent = false;
        if (desiredSeat.value !== mySeat.value) {
          desiredSeat.value = mySeat.value;
          persist();
        }
        break;
      case 'error':
        error.value = msg.code;
        if (msg.code === 'no-room') {
          stop();
          writeStored(null);
        }
        break;
      case 'pong':
        break;
    }
  };

  function stop() {
    unsub?.();
    unsubStatus?.();
    unsub = unsubStatus = null;
    conn?.close();
    conn = null;
    status.value = 'closed';
    joined.value = false;
    claimSent = false;
  }

  function start(code: string, seat?: PlayerId | null, displayName?: string) {
    stop();
    room.value = code.toUpperCase();
    desiredSeat.value = seat ?? null;
    name = displayName?.trim() || undefined;
    hostOnline.value = null;
    game.value = null;
    seats.value = {};
    lastRefused.value = null;
    error.value = null;
    persist();
    const c = connect<ServerToRemote, RemoteToServer>({
      url: opts.url ?? relayUrl(),
      WebSocketImpl: opts.WebSocketImpl,
      hello: () => {
        joined.value = false;
        claimSent = false;
        return [{ t: 'join', room: room.value!, clientId: myClientId, ...(name ? { name } : {}) }];
      },
    });
    conn = c;
    unsub = c.onMessage(onMessage);
    status.value = c.status.value;
    unsubStatus = c.status.subscribe((s) => {
      status.value = s;
      if (s !== 'open') joined.value = false;
    });
  }

  return {
    status, hostOnline, room, joined, game, seats, myClientId, mySeat, desiredSeat, clockOffset, lastRefused, error,
    hostTime: () => Date.now() + clockOffset.value,
    start,
    claim(playerId) {
      desiredSeat.value = playerId;
      lastRefused.value = null;
      claimSent = false;
      persist();
      maybeClaim();
    },
    release() {
      desiredSeat.value = null;
      persist();
      send({ t: 'release' });
    },
    act(action) { send({ t: 'action', action }); },
    undo() { send({ t: 'undo' }); },
    clearRefused() { lastRefused.value = null; },
    leave() {
      stop();
      writeStored(null);
      room.value = null;
      game.value = null;
      seats.value = {};
      desiredSeat.value = null;
      hostOnline.value = null;
    },
  };
}

/** App-wide instance used by the remote UI. */
export const remote = createRemote();
