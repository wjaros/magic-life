import { describe, expect, it } from 'vitest';
import type { ClockState } from '../core/types';
import {
  createClock,
  formatMs,
  nextTurn,
  pause,
  setActive,
  snapshot,
  start,
} from './clock';

const IDS = ['a', 'b', 'c'];

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

describe('createClock', () => {
  it('starts paused on turn 1 with the given first player and zeroed counters', () => {
    const c = createClock(IDS, 'b');
    expect(c).toEqual({
      running: false,
      activePlayerId: 'b',
      turn: 1,
      segmentStartedAt: null,
      gameElapsedMs: 0,
      playerElapsedMs: { a: 0, b: 0, c: 0 },
      turnElapsedMs: 0,
    });
  });

  it('allows a null first player', () => {
    const c = createClock(IDS, null);
    expect(c.activePlayerId).toBeNull();
    expect(c.playerElapsedMs).toEqual({ a: 0, b: 0, c: 0 });
  });
});

describe('start / pause', () => {
  it('start sets running and the segment start', () => {
    const c = start(createClock(IDS, 'a'), 1000);
    expect(c.running).toBe(true);
    expect(c.segmentStartedAt).toBe(1000);
  });

  it('start is a no-op when already running', () => {
    const running = start(createClock(IDS, 'a'), 1000);
    expect(start(running, 5000)).toEqual(running);
  });

  it('pause folds the segment into game, turn and active player time', () => {
    const c = pause(start(createClock(IDS, 'a'), 1000), 4000);
    expect(c.running).toBe(false);
    expect(c.segmentStartedAt).toBeNull();
    expect(c.gameElapsedMs).toBe(3000);
    expect(c.turnElapsedMs).toBe(3000);
    expect(c.playerElapsedMs).toEqual({ a: 3000, b: 0, c: 0 });
  });

  it('pause is a no-op when not running', () => {
    const c = createClock(IDS, 'a');
    expect(pause(c, 9999)).toEqual(c);
  });

  it('accumulates across pause/resume cycles', () => {
    let c = createClock(IDS, 'a');
    c = start(c, 0);
    c = pause(c, 10_000);
    c = start(c, 50_000);
    c = pause(c, 55_000);
    expect(c.gameElapsedMs).toBe(15_000);
    expect(c.turnElapsedMs).toBe(15_000);
    expect(c.playerElapsedMs.a).toBe(15_000);
  });

  it('with no active player, game time counts but no player time does', () => {
    const c = pause(start(createClock(IDS, null), 0), 2000);
    expect(c.gameElapsedMs).toBe(2000);
    expect(c.playerElapsedMs).toEqual({ a: 0, b: 0, c: 0 });
  });

  it('start is allowed with a null active player', () => {
    const c = start(createClock(IDS, null), 500);
    expect(c.running).toBe(true);
    expect(c.segmentStartedAt).toBe(500);
  });
});

describe('nextTurn', () => {
  it('folds the segment, advances turn, resets turn timer and restarts the segment when running', () => {
    let c = start(createClock(IDS, 'a'), 0);
    c = nextTurn(c, IDS, IDS, 7000);
    expect(c.activePlayerId).toBe('b');
    expect(c.turn).toBe(2);
    expect(c.turnElapsedMs).toBe(0);
    expect(c.gameElapsedMs).toBe(7000);
    expect(c.playerElapsedMs).toEqual({ a: 7000, b: 0, c: 0 });
    expect(c.running).toBe(true);
    expect(c.segmentStartedAt).toBe(7000);
  });

  it('stays paused and does not start a segment when not running', () => {
    const c = nextTurn(createClock(IDS, 'a'), IDS, IDS, 7000);
    expect(c.running).toBe(false);
    expect(c.segmentStartedAt).toBeNull();
    expect(c.activePlayerId).toBe('b');
    expect(c.turn).toBe(2);
  });

  it('wraps around from the last player to the first', () => {
    const c = nextTurn(createClock(IDS, 'c'), IDS, IDS, 0);
    expect(c.activePlayerId).toBe('a');
  });

  it('skips dead players', () => {
    const c = nextTurn(createClock(IDS, 'a'), IDS, ['a', 'c'], 0);
    expect(c.activePlayerId).toBe('c');
  });

  it('skips dead players across the wrap-around', () => {
    const c = nextTurn(createClock(IDS, 'c'), IDS, ['b', 'c'], 0);
    expect(c.activePlayerId).toBe('b');
  });

  it('skips several consecutive dead players', () => {
    const order = ['a', 'b', 'c', 'd'];
    const c = nextTurn(createClock(order, 'a'), order, ['a', 'd'], 0);
    expect(c.activePlayerId).toBe('d');
  });

  it('returns the only alive player when the active one is dead', () => {
    const c = nextTurn(createClock(IDS, 'a'), IDS, ['b'], 0);
    expect(c.activePlayerId).toBe('b');
  });

  it('picks the first alive player when there is no active player', () => {
    const c = nextTurn(createClock(IDS, null), IDS, ['b', 'c'], 0);
    expect(c.activePlayerId).toBe('b');
    expect(c.turn).toBe(2);
  });

  it('keeps a null active player when nobody is alive, but still advances the turn', () => {
    const c = nextTurn(createClock(IDS, null), IDS, [], 0);
    expect(c.activePlayerId).toBeNull();
    expect(c.turn).toBe(2);
  });

  it('keeps the current active player when nobody is alive', () => {
    const c = nextTurn(createClock(IDS, 'a'), IDS, [], 0);
    expect(c.activePlayerId).toBe('a');
  });

  it('uses the playing order, not the alive list, for sequencing', () => {
    const c = nextTurn(createClock(IDS, 'a'), ['a', 'c', 'b'], IDS, 0);
    expect(c.activePlayerId).toBe('c');
  });
});

describe('setActive', () => {
  it('folds the segment into the old active player, switches, resets turn timer and keeps turn', () => {
    let c = start(createClock(IDS, 'a'), 0);
    c = setActive(c, 'c', 4000);
    expect(c.activePlayerId).toBe('c');
    expect(c.turn).toBe(1);
    expect(c.turnElapsedMs).toBe(0);
    expect(c.gameElapsedMs).toBe(4000);
    expect(c.playerElapsedMs).toEqual({ a: 4000, b: 0, c: 0 });
    expect(c.running).toBe(true);
    expect(c.segmentStartedAt).toBe(4000);
  });

  it('does not start a segment when paused', () => {
    const c = setActive(createClock(IDS, 'a'), 'b', 4000);
    expect(c.activePlayerId).toBe('b');
    expect(c.running).toBe(false);
    expect(c.segmentStartedAt).toBeNull();
  });

  it('subsequent running time is credited to the newly active player', () => {
    let c = start(createClock(IDS, 'a'), 0);
    c = setActive(c, 'b', 1000);
    c = pause(c, 3000);
    expect(c.playerElapsedMs).toEqual({ a: 1000, b: 2000, c: 0 });
    expect(c.gameElapsedMs).toBe(3000);
  });
});

describe('snapshot', () => {
  it('shows live values while running', () => {
    const c = start(createClock(IDS, 'a'), 0);
    const s = snapshot(c, 3000, null);
    expect(s).toEqual({
      running: true,
      activePlayerId: 'a',
      turn: 1,
      gameMs: 3000,
      turnMs: 3000,
      playerMs: { a: 3000, b: 0, c: 0 },
      overTurnLimit: false,
    });
  });

  it('ignores `now` while paused', () => {
    const c = pause(start(createClock(IDS, 'a'), 0), 2000);
    const s = snapshot(c, 999_999, null);
    expect(s.gameMs).toBe(2000);
    expect(s.turnMs).toBe(2000);
    expect(s.playerMs.a).toBe(2000);
    expect(s.running).toBe(false);
  });

  it('adds the live segment to the active player only', () => {
    let c = start(createClock(IDS, 'a'), 0);
    c = nextTurn(c, IDS, IDS, 1000); // a: 1000, now active b, segment at 1000
    const s = snapshot(c, 1500, null);
    expect(s.playerMs).toEqual({ a: 1000, b: 500, c: 0 });
    expect(s.gameMs).toBe(1500);
    expect(s.turnMs).toBe(500);
    expect(s.turn).toBe(2);
  });

  it('reports overTurnLimit only when turnMs exceeds the limit', () => {
    const c = start(createClock(IDS, 'a'), 0);
    expect(snapshot(c, 5000, 5000).overTurnLimit).toBe(false);
    expect(snapshot(c, 5001, 5000).overTurnLimit).toBe(true);
  });

  it('never reports overTurnLimit without a limit', () => {
    const c = start(createClock(IDS, 'a'), 0);
    expect(snapshot(c, 10_000_000, null).overTurnLimit).toBe(false);
  });

  it('treats a `now` before the segment start as zero extra time', () => {
    const c = start(createClock(IDS, 'a'), 5000);
    const s = snapshot(c, 1000, 100);
    expect(s.gameMs).toBe(0);
    expect(s.turnMs).toBe(0);
    expect(s.playerMs.a).toBe(0);
    expect(s.overTurnLimit).toBe(false);
  });

  it('includes a null-active clock without crediting any player', () => {
    const c = start(createClock(IDS, null), 0);
    const s = snapshot(c, 2000, null);
    expect(s.gameMs).toBe(2000);
    expect(s.playerMs).toEqual({ a: 0, b: 0, c: 0 });
  });

  it('survives a locked screen: start at t, snapshot at t+5 min shows 5:00', () => {
    const t = 1_700_000_000_000;
    const c = start(createClock(IDS, 'a'), t);
    const s = snapshot(c, t + 300_000, null);
    expect(s.gameMs).toBe(300_000);
    expect(s.turnMs).toBe(300_000);
    expect(s.playerMs.a).toBe(300_000);
    expect(formatMs(s.gameMs)).toBe('5:00');
  });

  it('does not grow after pause even if the phone sleeps for hours', () => {
    const t = 1_700_000_000_000;
    const c = pause(start(createClock(IDS, 'a'), t), t + 300_000);
    const s = snapshot(c, t + 3 * 3_600_000, null);
    expect(s.gameMs).toBe(300_000);
  });
});

describe('purity', () => {
  it('works on deep-frozen inputs and does not mutate them', () => {
    const clock = deepFreeze(createClock(IDS, 'a'));
    const order = deepFreeze([...IDS]);
    const alive = deepFreeze(['a', 'b']);
    const before = JSON.parse(JSON.stringify(clock)) as ClockState;

    const running = start(clock, 0);
    const paused = pause(running, 1000);
    const advanced = nextTurn(running, order, alive, 2000);
    const switched = setActive(running, 'c', 2000);
    const snap = snapshot(advanced, 3000, 500);

    expect(paused.gameElapsedMs).toBe(1000);
    expect(advanced.activePlayerId).toBe('b');
    expect(switched.activePlayerId).toBe('c');
    expect(snap.overTurnLimit).toBe(true);
    expect(clock).toEqual(before);
    expect(clock.running).toBe(false);
    expect(running).not.toBe(clock);
  });

  it('returns new objects rather than aliasing the input', () => {
    const clock = createClock(IDS, 'a');
    const next = nextTurn(start(clock, 0), IDS, IDS, 10);
    expect(next.playerElapsedMs).not.toBe(clock.playerElapsedMs);
  });
});

describe('formatMs', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [1000, '0:01'],
    [65_000, '1:05'],
    [300_000, '5:00'],
    [3_599_999, '59:59'],
    [3_600_000, '1:00:00'],
    [3_725_000, '1:02:05'],
    [36_000_000, '10:00:00'],
  ])('formats %i ms as %s', (ms, expected) => {
    expect(formatMs(ms)).toBe(expected);
  });

  it('clamps negative and non-finite input to 0:00', () => {
    expect(formatMs(-5000)).toBe('0:00');
    expect(formatMs(Number.NaN)).toBe('0:00');
    expect(formatMs(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});
