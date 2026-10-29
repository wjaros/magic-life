import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState, History, Player } from '../core/types';
import { flushSaves, loadLastSeen, pauseIfStale, saveSoon, storage } from './index';

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
    customCounters: [],
    pinned: [],
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

  it('keeps a valid seating and drops an invalid one; old saves without it load', () => {
    const withSeating = (seating: unknown): History => {
      const h = makeHistory(0);
      return { ...h, present: { ...h.present, settings: { ...h.present.settings, seating } as GameState['settings'] } };
    };
    storage.save(withSeating('ends'));
    expect(storage.load()?.present.settings.seating).toBe('ends');
    storage.save(withSeating('sides'));
    expect(storage.load()?.present.settings.seating).toBe('sides');
    storage.save(withSeating('diagonal'));
    const loaded = storage.load();
    expect(loaded).not.toBeNull();
    expect(loaded?.present.settings.seating).toBeUndefined();
    storage.save(makeHistory(0));
    expect(storage.load()?.present.settings).toEqual({ startingLife: 40, turnLimitMs: null });
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

describe('deep validation', () => {
  const store = (present: unknown, past: unknown[] = []) =>
    localStorage.setItem(KEY, JSON.stringify({ version: 1, history: { past, present, future: [] } }));

  it('rejects a present state without clock or with partial players', () => {
    const { clock: _c, ...noClock } = makeState();
    store(noClock);
    expect(storage.load()).toBeNull();
    store({ version: 1, players: [{ id: 'p1' }] });
    expect(storage.load()).toBeNull();
  });

  it('rejects bad nested fields', () => {
    const s = makeState();
    store({ ...s, clock: { ...s.clock, playerElapsedMs: { p1: 'x' } } });
    expect(storage.load()).toBeNull();
    store({ ...s, settings: {} });
    expect(storage.load()).toBeNull();
    store({ ...s, players: [{ ...s.players[0], commanderCasts: [1] }] });
    expect(storage.load()).toBeNull();
    store({ ...s, players: [{ ...s.players[0], commanderDamage: { p2: 5 } }] });
    expect(storage.load()).toBeNull();
    store({ ...s, players: [{ ...s.players[0], rotation: 45 }] });
    expect(storage.load()).toBeNull();
  });

  it('drops invalid past entries but keeps the game', () => {
    store(makeState(7), [makeState(1), { version: 1, players: [] }, makeState(2)]);
    const h = storage.load();
    expect(h?.past).toHaveLength(2);
    expect(h?.present.players[0]?.life).toBe(7);
  });
});

describe('lastSeen / pauseIfStale', () => {
  const running = (): History => {
    const h = makeHistory(0);
    h.present = {
      ...h.present,
      clock: { ...h.present.clock, running: true, segmentStartedAt: 1000 },
    };
    return h;
  };

  it('pauses at lastSeen when the gap exceeds 10 minutes', () => {
    const h = pauseIfStale(running(), 61_000, 61_000 + 11 * 60_000);
    expect(h.present.clock.running).toBe(false);
    expect(h.present.clock.gameElapsedMs).toBe(60_000);
  });

  it('leaves a recent or paused game alone', () => {
    const r = running();
    expect(pauseIfStale(r, 1000, 1000 + 5 * 60_000)).toBe(r);
    expect(pauseIfStale(r, null, 10 ** 12)).toBe(r);
    const p = makeHistory(0);
    expect(pauseIfStale(p, 0, 10 ** 12)).toBe(p);
  });

  it('save writes lastSeen; clear removes it', () => {
    expect(loadLastSeen()).toBeNull();
    storage.save(makeHistory(0));
    expect(loadLastSeen()).toBeGreaterThan(0);
    storage.clear();
    expect(loadLastSeen()).toBeNull();
  });
});

describe('saveSoon maxWait', () => {
  it('writes within 2 s even if changes keep coming', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 20; i++) {
      saveSoon(makeHistory(0));
      vi.advanceTimersByTime(150);
    }
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });
});

describe('storage: pinned and custom counters', () => {
  const wrap = (h: unknown) => JSON.stringify({ version: 1, history: h });
  const stripped = (): unknown => {
    const h = makeHistory(1);
    const strip = (g: GameState) => ({
      ...g,
      players: g.players.map(({ customCounters: _c, pinned: _p, ...rest }) => rest),
    });
    return { past: h.past.map(strip), present: strip(h.present), future: [] };
  };

  it('round-trips counters and pins', () => {
    const h = makeHistory(0);
    h.present.players[0]!.customCounters = [{ id: 'c1', name: 'Skarby', value: 4 }];
    h.present.players[0]!.pinned = ['energy', 'c1'];
    storage.save(h);
    expect(storage.load()).toEqual(h);
  });

  it('loads old saves without the new fields, migrating to empty arrays', () => {
    localStorage.setItem(KEY, wrap(stripped()));
    const loaded = storage.load();
    expect(loaded).not.toBeNull();
    for (const g of [...loaded!.past, loaded!.present]) {
      for (const p of g.players) {
        expect(p.customCounters).toEqual([]);
        expect(p.pinned).toEqual([]);
      }
    }
  });

  it('drops malformed counters and invalid pins instead of rejecting', () => {
    const h = makeHistory(0) as unknown as { present: { players: Record<string, unknown>[] } };
    h.present.players[0]!.customCounters = [
      { id: 'c1', name: 'ok', value: 2 },
      { id: 'c1', name: 'dup', value: 1 },
      { id: 5, name: 'bad', value: 1 },
      { id: 'c3', name: 'nan', value: 'x' },
      'junk',
    ];
    h.present.players[0]!.pinned = ['c1', 'c3', 'nope', 'c1', 'tax', 'energy'];
    h.present.players[1]!.customCounters = 'oops';
    h.present.players[1]!.pinned = 7;
    localStorage.setItem(KEY, wrap(h));
    const loaded = storage.load()!;
    expect(loaded.present.players[0]!.customCounters).toEqual([{ id: 'c1', name: 'ok', value: 2 }]);
    expect(loaded.present.players[0]!.pinned).toEqual(['c1', 'tax']);
    expect(loaded.present.players[1]!.customCounters).toEqual([]);
    expect(loaded.present.players[1]!.pinned).toEqual([]);
  });
});
