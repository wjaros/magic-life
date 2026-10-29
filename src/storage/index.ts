import type { StorageApi } from '../core/api';
import type { GameState, History } from '../core/types';

const STORAGE_KEY = 'magic-life/v1';
const SCHEMA_VERSION = 1;
/** Only the most recent undo steps are persisted, to keep the stored blob small. */
const MAX_PERSISTED_PAST = 50;
const SAVE_DELAY_MS = 300;

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

function isGameState(value: unknown): value is GameState {
  return isRecord(value) && value.version === SCHEMA_VERSION && Array.isArray(value.players);
}

function isHistory(value: unknown): value is History {
  return (
    isRecord(value) &&
    Array.isArray(value.past) &&
    Array.isArray(value.future) &&
    isGameState(value.present) &&
    value.past.every(isGameState) &&
    value.future.every(isGameState)
  );
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
      const history = parsed.history;
      return isHistory(history) ? history : null;
    } catch {
      return null;
    }
  },

  clear(): void {
    try {
      getLocalStorage()?.removeItem(STORAGE_KEY);
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

function debounce<A extends unknown[]>(fn: (...args: A) => void, waitMs: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
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
    pendingArgs = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, waitMs);
  };

  return Object.assign(debounced, { flush, cancel });
}

/** Debounced save (300 ms). Call on every state change; only the last one is written. */
export const saveSoon = debounce((history: History) => storage.save(history), SAVE_DELAY_MS);

/** Writes any pending debounced save immediately. */
export function flushSaves(): void {
  saveSoon.flush();
}

// A pending debounced save must not be lost when the page is backgrounded or closed.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('pagehide', flushSaves);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSaves();
  });
}
