import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState, History, Player } from '../core/types';
import { flushSaves, saveSoon, storage } from './index';

const KEY = 'magic-life/v1';

function makePlayer(id: string, name: string, color: string, rotation: Player['rotation']): Player {
  return {
    id,
    name,
    color,
    life: 40,
    poison: 0,
    commanderCasts: [0, 0],
    hasPartner: false,
    energy: 0,
    experience: 0,
    commanderDamage: {},
    conceded: false,
    rotation,
  };
}

/** Minimal valid GameState; `life` distinguishes otherwise identical snapshots. */
function makeState(life = 40): GameState {
  const players = [makePlayer('p1', 'Ania', '#c0392b', 0), makePlayer('p2', 'Bartek', '#2980b9', 180)];
  players[0].life = life;
  return {
    version: 1,
    settings: { startingLife: 40, turnLimitMs: null },
    players,
    monarch: null,
    initiative: null,
    clock: {
      running: false,
      activePlayerId: 'p1',
      turn: 1,
      segmentStartedAt: null,
      gameElapsedMs: 0,
      playerElapsedMs: { p1: 0, p2: 0 },
      turnElapsedMs: 0,
    },
    createdAt: 1_700_000_000_000,
  };
}

function makeHistory(pastCount: number): History {
  return {
    past: Array.from({ length: pastCount }, (_, i) => makeState(i)),
    present: makeState(999),
    future: [],
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  saveSoon.cancel();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('storage.load', () => {
  it('returns null when nothing is stored', () => {
    expect(storage.load()).toBeNull();
  });

  it('round-trips a saved history', () => {
    const history = makeHistory(3);
    storage.save(history);
    expect(storage.load()).toEqual(history);
  });

  it('returns null for invalid JSON', () => {
    localStorage.setItem(KEY, '{not json');
    expect(storage.load()).toBeNull();
  });

  it('returns null when the schema version is unknown', () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 2, history: makeHistory(0) }));
    expect(storage.load()).toBeNull();
  });

  it('returns null when present.players is not an array', () => {
    const broken = { ...makeHistory(0), present: { ...makeState(), players: 'nope' } };
    localStorage.setItem(KEY, JSON.stringify({ version: 1, history: broken }));
    expect(storage.load()).toBeNull();
  });

  it('returns null when history is missing or malformed', () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 1 }));
    expect(storage.load()).toBeNull();

    localStorage.setItem(KEY, JSON.stringify({ version: 1, history: { past: 'x', present: makeState(), future: [] } }));
    expect(storage.load()).toBeNull();

    localStorage.setItem(KEY, JSON.stringify(null));
    expect(storage.load()).toBeNull();
  });
});

describe('storage.save', () => {
  it('stores the versioned envelope under the magic-life/v1 key', () => {
    storage.save(makeHistory(1));
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    expect(raw.version).toBe(1);
    expect(raw.history.past).toHaveLength(1);
    expect(raw.history.present.players).toHaveLength(2);
  });

  it('keeps only the last 50 entries of history.past', () => {
    const history = makeHistory(60);
    storage.save(history);

    const loaded = storage.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.past).toHaveLength(50);
    // The oldest 10 are dropped; the newest kept entry is the one just before present.
    expect(loaded!.past[0].players[0].life).toBe(10);
    expect(loaded!.past[49].players[0].life).toBe(59);
    expect(loaded!.present).toEqual(history.present);
  });

  it('does not throw when localStorage.setItem fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => storage.save(makeHistory(2))).not.toThrow();
  });
});

describe('storage.clear', () => {
  it('removes the saved state', () => {
    storage.save(makeHistory(1));
    storage.clear();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(storage.load()).toBeNull();
  });

  it('does not throw when localStorage.removeItem fails', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(() => storage.clear()).not.toThrow();
  });
});

describe('storage when localStorage is unavailable', () => {
  it('load returns null and save/clear never throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });

    expect(() => storage.save(makeHistory(1))).not.toThrow();
    expect(storage.load()).toBeNull();
    expect(() => storage.clear()).not.toThrow();
  });
});

describe('saveSoon', () => {
  it('writes once, 300 ms after the last call, with the latest history', () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(storage, 'save');

    const first = makeHistory(1);
    const last = makeHistory(4);
    saveSoon(first);
    vi.advanceTimersByTime(200);
    saveSoon(first);
    vi.advanceTimersByTime(200);
    saveSoon(last);

    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(299);
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(last);
    expect(storage.load()).toEqual(last);
  });

  it('flushSaves writes a pending save immediately', () => {
    vi.useFakeTimers();
    const history = makeHistory(2);
    saveSoon(history);
    expect(storage.load()).toBeNull();

    flushSaves();
    expect(storage.load()).toEqual(history);
  });
});
