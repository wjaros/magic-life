import type { StorageApi } from '../core/api';
import { dispatch } from '../core/history';
import { MAX_PINNED } from '../core/types';
import type { GameState, History } from '../core/types';

const STORAGE_KEY = 'magic-life/v1';
const SCHEMA_VERSION = 1;
/** Only the most recent undo steps are persisted, to keep the stored blob small. */
const MAX_PERSISTED_PAST = 50;
const SAVE_DELAY_MS = 300;
const SAVE_MAX_WAIT_MS = 2000;
const LAST_SEEN_KEY = 'magic-life/lastSeen';
const LAST_SEEN_INTERVAL_MS = 30_000;

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Accessing localStorage can throw (blocked site data, sandboxed iframe, private mode).
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v);
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isPair = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && v.every(isNum);

const BUILTIN_PINS = ['energy', 'experience', 'poison', 'tax'];

/**
 * Migrates/sanitizes the counter fields of a raw player in place of rejecting the save:
 * saves written before pinned/custom counters existed get `[]`; malformed entries are dropped.
 */
function normalizePlayer(v: unknown): unknown {
  if (!isRecord(v)) return v;
  const seen = new Set<string>();
  const customCounters = (Array.isArray(v.customCounters) ? v.customCounters : []).filter(
    (c): c is { id: string; name: string; value: number } => {
      if (!isRecord(c) || typeof c.id !== 'string' || typeof c.name !== 'string' || !isNum(c.value)) {
        return false;
      }
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    },
  );
  const pinned: string[] = [];
  for (const k of Array.isArray(v.pinned) ? v.pinned : []) {
    if (typeof k !== 'string' || pinned.includes(k)) continue;
    if (BUILTIN_PINS.includes(k) || seen.has(k)) pinned.push(k);
  }
  return { ...v, customCounters, pinned: pinned.slice(0, MAX_PINNED) };
}

function normalizeGame(v: unknown): unknown {
  if (!isRecord(v) || !Array.isArray(v.players)) return v;
  return { ...v, players: v.players.map(normalizePlayer) };
}

function isPlayer(v: unknown): boolean {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.color === 'string' &&
    isNum(v.life) &&
    isNum(v.poison) &&
    isNum(v.energy) &&
    isNum(v.experience) &&
    isPair(v.commanderCasts) &&
    typeof v.hasPartner === 'boolean' &&
    typeof v.conceded === 'boolean' &&
    (v.rotation === 0 || v.rotation === 90 || v.rotation === 180 || v.rotation === 270) &&
    Array.isArray(v.customCounters) &&
    Array.isArray(v.pinned) &&
    isRecord(v.commanderDamage) &&
    Object.values(v.commanderDamage).every(isPair)
  );
}

function isClock(v: unknown): boolean {
  if (!isRecord(v)) return false;
  return (
    typeof v.running === 'boolean' &&
    isStrOrNull(v.activePlayerId) &&
    isNum(v.turn) &&
    isNumOrNull(v.segmentStartedAt) &&
    isNum(v.gameElapsedMs) &&
    isNum(v.turnElapsedMs) &&
    isRecord(v.playerElapsedMs) &&
    Object.values(v.playerElapsedMs).every(isNum)
  );
}

function isGameState(value: unknown): value is GameState {
  if (!isRecord(value) || value.version !== SCHEMA_VERSION) return false;
  const st = value.settings;
  return (
    isRecord(st) &&
    isNum(st.startingLife) &&
    isNumOrNull(st.turnLimitMs) &&
    Array.isArray(value.players) &&
    value.players.length > 0 &&
    value.players.every(isPlayer) &&
    isStrOrNull(value.monarch) &&
    isStrOrNull(value.initiative) &&
    isClock(value.clock) &&
    isNum(value.createdAt)
  );
}

function isHistory(value: unknown): value is History {
  return (
    isRecord(value) &&
    Array.isArray(value.past) &&
    Array.isArray(value.future) &&
    isGameState(value.present)
  );
}

/** Records "the app was alive at `now`" (used to detect a closed app with a running clock). */
export function markSeen(now: number = Date.now()): void {
  try {
    getLocalStorage()?.setItem(LAST_SEEN_KEY, String(now));
  } catch {
    // Ignore: storage unavailable.
  }
}

export function loadLastSeen(): number | null {
  try {
    const raw = getLocalStorage()?.getItem(LAST_SEEN_KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** A running clock whose app was last seen longer ago than this is treated as closed. */
export const STALE_GAP_MS = 10 * 60_000;

/**
 * If the game's clock is running but the app was last seen more than 10 min before `now`,
 * the closed period must not count: pause the clock at `lastSeen`.
 */
export function pauseIfStale(history: History, lastSeen: number | null, now: number): History {
  if (lastSeen === null || !history.present.clock.running) return history;
  if (now - lastSeen <= STALE_GAP_MS) return history;
  return dispatch(history, { type: 'clockPause', now: lastSeen });
}

export const storage: StorageApi = {
  save(history: History): void {
    try {
      const ls = getLocalStorage();
      if (!ls) return;
      const payload = {
        version: SCHEMA_VERSION,
        history: {
          past: history.past.slice(-MAX_PERSISTED_PAST),
          present: history.present,
          future: history.future,
        },
      };
      ls.setItem(STORAGE_KEY, JSON.stringify(payload));
      markSeen();
    } catch {
      // Quota exceeded or storage unavailable: the game keeps working without persistence.
    }
  },

  load(): History | null {
    try {
      const ls = getLocalStorage();
      if (!ls) return null;
      const raw = ls.getItem(STORAGE_KEY);
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || parsed.version !== SCHEMA_VERSION) return null;
      const raw0 = parsed.history;
      if (!isRecord(raw0)) return null;
      const history = {
        ...raw0,
        past: Array.isArray(raw0.past) ? raw0.past.map(normalizeGame) : raw0.past,
        present: normalizeGame(raw0.present),
        future: Array.isArray(raw0.future) ? raw0.future.map(normalizeGame) : raw0.future,
      };
      if (!isHistory(history)) return null;
      // Invalid undo/redo entries are dropped rather than rejecting the whole game.
      return {
        past: history.past.filter(isGameState),
        present: history.present,
        future: history.future.filter(isGameState),
      };
    } catch {
      return null;
    }
  },

  clear(): void {
    try {
      getLocalStorage()?.removeItem(STORAGE_KEY);
      getLocalStorage()?.removeItem(LAST_SEEN_KEY);
    } catch {
      // Ignore: nothing to clear if storage is unavailable.
    }
  },
};

interface Debounced<A extends unknown[]> {
  (...args: A): void;
  flush(): void;
  cancel(): void;
}

function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number,
  maxWaitMs: number,
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstAt = 0;
  let pendingArgs: A | null = null;

  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pendingArgs = null;
  };

  const flush = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (pendingArgs !== null) {
      const args = pendingArgs;
      pendingArgs = null;
      fn(...args);
    }
  };

  const debounced = (...args: A): void => {
    const t = Date.now();
    if (pendingArgs === null) firstAt = t;
    pendingArgs = args;
    if (timer !== null) clearTimeout(timer);
    // Never postpone the write past maxWaitMs since the first pending change.
    timer = setTimeout(flush, Math.max(0, Math.min(waitMs, firstAt + maxWaitMs - t)));
  };

  return Object.assign(debounced, { flush, cancel });
}

/** Debounced save (300 ms, max wait 2 s). Call on every state change; only the last one is written. */
export const saveSoon = debounce((history: History) => storage.save(history), SAVE_DELAY_MS, SAVE_MAX_WAIT_MS);

/** Writes any pending debounced save immediately. */
export function flushSaves(): void {
  saveSoon.flush();
}

// A pending debounced save must not be lost when the page is backgrounded or closed.
// lastSeen is refreshed on hide/show and every ~30 s while visible. If the app is killed
// while hidden, the next startup compares against it (see src/main.tsx). Note: a page that
// stays hidden >10 min and is then reloaded counts as "closed" and pauses the clock.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('pagehide', () => {
    flushSaves();
    markSeen();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSaves();
    markSeen();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') markSeen();
  }, LAST_SEEN_INTERVAL_MS);
}
