import { describe, expect, it } from 'vitest';
import { createGame, reduce, rotationsFor } from './game';
import { alivePlayers, lossReason } from './rules';
import { dispatch, initHistory, undo } from './history';
import { snapshot } from '../timer/clock';
import type { Action, GameSettings, GameState, PlayerSetup } from './types';

const settings: GameSettings = { startingLife: 40, turnLimitMs: null };
const setups = (n: number): PlayerSetup[] =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, color: `#00${i}` }));
const mk = (n = 4) => createGame(setups(n), settings, 1000);
const get = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;

describe('createGame', () => {
  it('builds players with ids, life and commander damage maps', () => {
    const s = mk(3);
    expect(s.version).toBe(1);
    expect(s.createdAt).toBe(1000);
    expect(s.players.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(get(s, 'p1').life).toBe(40);
    expect(get(s, 'p1').commanderDamage).toEqual({ p2: [0, 0], p3: [0, 0] });
    expect(s.monarch).toBeNull();
    expect(s.initiative).toBeNull();
    expect(s.clock.activePlayerId).toBe('p1');
    expect(s.clock.running).toBe(false);
    expect(s.clock.turn).toBe(1);
    expect(s.clock.playerElapsedMs).toEqual({ p1: 0, p2: 0, p3: 0 });
  });

  it('honours hasPartner and copies settings', () => {
    const s = createGame([{ name: 'a', color: 'x', hasPartner: true }, { name: 'b', color: 'y' }], settings, 0);
    expect(get(s, 'p1').hasPartner).toBe(true);
    expect(get(s, 'p2').hasPartner).toBe(false);
    expect(s.settings).not.toBe(settings);
  });

  it('assigns deterministic rotations for 1-8 players', () => {
    expect(rotationsFor(2)).toEqual([180, 0]);
    expect(rotationsFor(3)).toEqual([180, 90, 270]);
    expect(rotationsFor(4)).toEqual([90, 270, 90, 270]);
    expect(rotationsFor(5)).toEqual([90, 270, 90, 270, 0]);
    expect(rotationsFor(6)).toEqual([90, 270, 90, 270, 90, 270]);
    expect(rotationsFor(1)).toEqual([0]);
    expect(rotationsFor(8)).toHaveLength(8);
    expect(mk(2).players.map((p) => p.rotation)).toEqual([180, 0]);
  });

  it('seating "ends" tables', () => {
    expect(rotationsFor(2, 'ends')).toEqual([180, 0]);
    expect(rotationsFor(3, 'ends')).toEqual([180, 0, 0]);
    expect(rotationsFor(4, 'ends')).toEqual([180, 180, 0, 0]);
    expect(rotationsFor(5, 'ends')).toEqual([180, 180, 90, 270, 0]);
    expect(rotationsFor(6, 'ends')).toEqual([180, 180, 90, 270, 0, 0]);
    expect(rotationsFor(4, 'sides')).toEqual(rotationsFor(4));
    const s = createGame(setups(4), { ...settings, seating: 'ends' }, 0);
    expect(s.players.map((p) => p.rotation)).toEqual([180, 180, 0, 0]);
  });

  it('handles empty player list', () => {
    const s = createGame([], settings, 0);
    expect(s.players).toEqual([]);
    expect(s.clock.activePlayerId).toBeNull();
  });
});

describe('reduce counters', () => {
  it('newGame replaces the state', () => {
    const s = reduce(mk(4), { type: 'newGame', players: setups(2), settings: { startingLife: 20, turnLimitMs: 5 }, now: 7 });
    expect(s.players).toHaveLength(2);
    expect(get(s, 'p1').life).toBe(20);
    expect(s.createdAt).toBe(7);
  });

  it('adjustLife changes life, may go negative, zero is a no-op', () => {
    const s = mk();
    expect(get(reduce(s, { type: 'adjustLife', playerId: 'p2', delta: -7 }), 'p2').life).toBe(33);
    expect(get(reduce(s, { type: 'adjustLife', playerId: 'p2', delta: -50 }), 'p2').life).toBe(-10);
    expect(reduce(s, { type: 'adjustLife', playerId: 'p2', delta: 0 })).toBe(s);
  });

  it.each([
    ['adjustPoison', 'poison'],
    ['adjustEnergy', 'energy'],
    ['adjustExperience', 'experience'],
  ] as const)('%s clamps at 0', (type, field) => {
    const s = mk();
    const up = reduce(s, { type, playerId: 'p1', delta: 3 });
    expect(get(up, 'p1')[field]).toBe(3);
    const down = reduce(up, { type, playerId: 'p1', delta: -10 });
    expect(get(down, 'p1')[field]).toBe(0);
    expect(reduce(down, { type, playerId: 'p1', delta: -1 })).toBe(down);
  });

  it('adjustCommanderCasts is per slot and clamps', () => {
    let s = mk();
    s = reduce(s, { type: 'adjustCommanderCasts', playerId: 'p1', slot: 1, delta: 2 });
    expect(get(s, 'p1').commanderCasts).toEqual([0, 2]);
    s = reduce(s, { type: 'adjustCommanderCasts', playerId: 'p1', slot: 1, delta: -5 });
    expect(get(s, 'p1').commanderCasts).toEqual([0, 0]);
    expect(reduce(s, { type: 'adjustCommanderCasts', playerId: 'p1', slot: 0, delta: -1 })).toBe(s);
  });
});

describe('adjustCommanderDamage', () => {
  const dmg = (s: GameState, delta: number, slot: 0 | 1 = 0, targetId = 'p1', sourceId = 'p2') =>
    reduce(s, { type: 'adjustCommanderDamage', targetId, sourceId, slot, delta });

  it('changes damage and life by -delta', () => {
    const s = dmg(mk(), 5);
    expect(get(s, 'p1').commanderDamage.p2).toEqual([5, 0]);
    expect(get(s, 'p1').life).toBe(35);
  });

  it('negative delta restores life; clamps at 0 without over-restoring', () => {
    let s = dmg(mk(), 5);
    s = dmg(s, -2);
    expect(get(s, 'p1').commanderDamage.p2[0]).toBe(3);
    expect(get(s, 'p1').life).toBe(37);
    s = dmg(s, -10);
    expect(get(s, 'p1').commanderDamage.p2[0]).toBe(0);
    expect(get(s, 'p1').life).toBe(40);
    expect(dmg(s, -1)).toBe(s);
  });

  it('tracks partner slot separately', () => {
    const s = dmg(dmg(mk(), 4, 0), 6, 1);
    expect(get(s, 'p1').commanderDamage.p2).toEqual([4, 6]);
    expect(get(s, 'p1').life).toBe(30);
  });

  it('ignores unknown ids and self damage', () => {
    const s = mk();
    expect(dmg(s, 3, 0, 'nope')).toBe(s);
    expect(dmg(s, 3, 0, 'p1', 'nope')).toBe(s);
    expect(dmg(s, 3, 0, 'p1', 'p1')).toBe(s);
  });

  it('creates a missing source entry if source exists but map lacks it', () => {
    const s = mk();
    const broken: GameState = {
      ...s,
      players: s.players.map((p) => (p.id === 'p1' ? { ...p, commanderDamage: {} } : p)),
    };
    expect(get(dmg(broken, 2), 'p1').commanderDamage.p2).toEqual([2, 0]);
  });
});

describe('reduce misc actions', () => {
  it('setMonarch / setInitiative set, clear and ignore unknown', () => {
    let s = mk();
    s = reduce(s, { type: 'setMonarch', playerId: 'p3' });
    expect(s.monarch).toBe('p3');
    expect(reduce(s, { type: 'setMonarch', playerId: 'p3' })).toBe(s);
    expect(reduce(s, { type: 'setMonarch', playerId: 'zzz' })).toBe(s);
    expect(reduce(s, { type: 'setMonarch', playerId: null }).monarch).toBeNull();
    s = reduce(s, { type: 'setInitiative', playerId: 'p2' });
    expect(s.initiative).toBe('p2');
    expect(reduce(s, { type: 'setInitiative', playerId: 'p2' })).toBe(s);
    expect(reduce(s, { type: 'setInitiative', playerId: 'zzz' })).toBe(s);
    expect(reduce(s, { type: 'setInitiative', playerId: null }).initiative).toBeNull();
  });

  it('setConceded, rename, color, partner', () => {
    let s = mk();
    s = reduce(s, { type: 'setConceded', playerId: 'p1', conceded: true });
    expect(get(s, 'p1').conceded).toBe(true);
    expect(reduce(s, { type: 'setConceded', playerId: 'p1', conceded: true })).toBe(s);
    s = reduce(s, { type: 'renamePlayer', playerId: 'p1', name: 'Zed' });
    expect(get(s, 'p1').name).toBe('Zed');
    expect(reduce(s, { type: 'renamePlayer', playerId: 'p1', name: 'Zed' })).toBe(s);
    s = reduce(s, { type: 'setColor', playerId: 'p1', color: '#fff' });
    expect(get(s, 'p1').color).toBe('#fff');
    expect(reduce(s, { type: 'setColor', playerId: 'p1', color: '#fff' })).toBe(s);
    s = reduce(s, { type: 'setPartner', playerId: 'p1', hasPartner: true });
    expect(get(s, 'p1').hasPartner).toBe(true);
    expect(reduce(s, { type: 'setPartner', playerId: 'p1', hasPartner: true })).toBe(s);
  });

  it('unknown player ids return the same state for every player action', () => {
    const s = mk();
    const actions: Action[] = [
      { type: 'adjustLife', playerId: 'x', delta: 1 },
      { type: 'adjustPoison', playerId: 'x', delta: 1 },
      { type: 'adjustEnergy', playerId: 'x', delta: 1 },
      { type: 'adjustExperience', playerId: 'x', delta: 1 },
      { type: 'adjustCommanderCasts', playerId: 'x', slot: 0, delta: 1 },
      { type: 'setConceded', playerId: 'x', conceded: true },
      { type: 'renamePlayer', playerId: 'x', name: 'n' },
      { type: 'setColor', playerId: 'x', color: 'c' },
      { type: 'setPartner', playerId: 'x', hasPartner: true },
      { type: 'clockSetActive', playerId: 'x', now: 5 },
    ];
    for (const a of actions) expect(reduce(s, a)).toBe(s);
  });
});

describe('clock actions', () => {
  it('start, pause accumulate time per active player', () => {
    let s = mk(2);
    s = reduce(s, { type: 'clockStart', now: 2000 });
    expect(s.clock.running).toBe(true);
    s = reduce(s, { type: 'clockPause', now: 5000 });
    expect(s.clock.running).toBe(false);
    expect(s.clock.gameElapsedMs).toBe(3000);
    expect(s.clock.playerElapsedMs.p1).toBe(3000);
    expect(s.clock.turnElapsedMs).toBe(3000);
    expect(s.clock.segmentStartedAt).toBeNull();
  });

  it('start while running and pause while paused are no-ops', () => {
    let s = reduce(mk(2), { type: 'clockStart', now: 10 });
    const again = reduce(s, { type: 'clockStart', now: 99 });
    expect(again.clock).toBe(s.clock);
    s = reduce(s, { type: 'clockPause', now: 20 });
    expect(reduce(s, { type: 'clockPause', now: 30 }).clock).toBe(s.clock);
  });

  it('nextTurn follows player order, wraps, bumps turn and resets turn time', () => {
    let s = reduce(mk(3), { type: 'clockStart', now: 0 });
    s = reduce(s, { type: 'clockNextTurn', now: 1000 });
    expect(s.clock.activePlayerId).toBe('p2');
    expect(s.clock.turn).toBe(2);
    expect(s.clock.turnElapsedMs).toBe(0);
    expect(s.clock.playerElapsedMs.p1).toBe(1000);
    s = reduce(s, { type: 'clockNextTurn', now: 1500 });
    s = reduce(s, { type: 'clockNextTurn', now: 1600 });
    expect(s.clock.activePlayerId).toBe('p1');
    expect(s.clock.turn).toBe(4);
    expect(s.clock.running).toBe(true);
  });

  it('nextTurn skips eliminated and conceded players', () => {
    let s = mk(4);
    s = reduce(s, { type: 'adjustLife', playerId: 'p2', delta: -40 });
    s = reduce(s, { type: 'setConceded', playerId: 'p3', conceded: true });
    s = reduce(s, { type: 'clockNextTurn', now: 5 });
    expect(s.clock.activePlayerId).toBe('p4');
  });

  it('nextTurn works while paused and with no active player', () => {
    let s = reduce(mk(2), { type: 'clockNextTurn', now: 5 });
    expect(s.clock.activePlayerId).toBe('p2');
    expect(s.clock.running).toBe(false);
    const none: GameState = { ...mk(2), clock: { ...mk(2).clock, activePlayerId: null } };
    s = reduce(none, { type: 'clockNextTurn', now: 5 });
    expect(s.clock.activePlayerId).toBe('p1');
  });

  it('nextTurn with nobody alive keeps the active player', () => {
    let s = mk(2);
    s = reduce(s, { type: 'setConceded', playerId: 'p1', conceded: true });
    s = reduce(s, { type: 'setConceded', playerId: 'p2', conceded: true });
    s = reduce(s, { type: 'clockNextTurn', now: 5 });
    expect(s.clock.activePlayerId).toBe('p1');
  });

  it('setActive switches player and resets turn time', () => {
    let s = reduce(mk(3), { type: 'clockStart', now: 0 });
    s = reduce(s, { type: 'clockSetActive', playerId: 'p3', now: 400 });
    expect(s.clock.activePlayerId).toBe('p3');
    expect(s.clock.playerElapsedMs.p1).toBe(400);
    expect(s.clock.turnElapsedMs).toBe(0);
    expect(s.clock.turn).toBe(1);
    const same = reduce(s, { type: 'clockSetActive', playerId: 'p3', now: 700 });
    expect(same.clock.activePlayerId).toBe('p3');
    expect(snapshot(same.clock, 700, null).turnMs).toBe(300);
  });

  it('clamps negative time deltas to zero', () => {
    let s = reduce(mk(2), { type: 'clockStart', now: 1000 });
    s = reduce(s, { type: 'clockPause', now: 500 });
    expect(s.clock.gameElapsedMs).toBe(0);
  });
});

describe('rules', () => {
  const dmg = (s: GameState, sourceId: string, slot: 0 | 1, delta: number, targetId = 'p1') =>
    reduce(s, { type: 'adjustCommanderDamage', targetId, sourceId, slot, delta });

  it('life <= 0 loses', () => {
    let s = mk();
    expect(lossReason(get(s, 'p1'))).toBeNull();
    s = reduce(s, { type: 'adjustLife', playerId: 'p1', delta: -39 });
    expect(lossReason(get(s, 'p1'))).toBeNull();
    s = reduce(s, { type: 'adjustLife', playerId: 'p1', delta: -1 });
    expect(lossReason(get(s, 'p1'))).toBe('life');
    s = reduce(s, { type: 'adjustLife', playerId: 'p1', delta: -5 });
    expect(lossReason(get(s, 'p1'))).toBe('life');
  });

  it('10 poison loses, 9 does not', () => {
    let s = reduce(mk(), { type: 'adjustPoison', playerId: 'p1', delta: 9 });
    expect(lossReason(get(s, 'p1'))).toBeNull();
    s = reduce(s, { type: 'adjustPoison', playerId: 'p1', delta: 1 });
    expect(lossReason(get(s, 'p1'))).toBe('poison');
  });

  it('21 from one commander loses, 20 does not', () => {
    let s = dmg(mk(), 'p2', 0, 20);
    expect(lossReason(get(s, 'p1'))).toBeNull();
    s = dmg(s, 'p2', 0, 1);
    expect(lossReason(get(s, 'p1'))).toBe('commander');
  });

  it('11 + 10 from two different sources is not lethal', () => {
    let s = dmg(mk(), 'p2', 0, 11);
    s = dmg(s, 'p3', 0, 10);
    expect(lossReason(get(s, 'p1'))).toBeNull();
  });

  it('partner slots are separate: 11 + 10 from same player is not lethal, 21 in slot 1 is', () => {
    let s = dmg(mk(), 'p2', 0, 11);
    s = dmg(s, 'p2', 1, 10);
    expect(lossReason(get(s, 'p1'))).toBeNull();
    s = dmg(s, 'p2', 1, 11);
    expect(lossReason(get(s, 'p1'))).toBe('commander');
  });

  it('conceded takes priority over other reasons', () => {
    let s = reduce(mk(), { type: 'adjustLife', playerId: 'p1', delta: -100 });
    s = reduce(s, { type: 'setConceded', playerId: 'p1', conceded: true });
    expect(lossReason(get(s, 'p1'))).toBe('conceded');
  });

  it('alivePlayers filters losers and can be revived', () => {
    let s = mk(3);
    s = reduce(s, { type: 'adjustLife', playerId: 'p1', delta: -40 });
    s = reduce(s, { type: 'setConceded', playerId: 'p2', conceded: true });
    expect(alivePlayers(s).map((p) => p.id)).toEqual(['p3']);
    s = reduce(s, { type: 'adjustLife', playerId: 'p1', delta: 5 });
    expect(alivePlayers(s).map((p) => p.id)).toEqual(['p1', 'p3']);
  });
});

describe('purity', () => {
  it('never mutates the input state', () => {
    const s = mk(3);
    const snapshot = JSON.stringify(s);
    const actions: Action[] = [
      { type: 'adjustLife', playerId: 'p1', delta: -3 },
      { type: 'adjustPoison', playerId: 'p1', delta: 2 },
      { type: 'adjustEnergy', playerId: 'p1', delta: 2 },
      { type: 'adjustExperience', playerId: 'p1', delta: 2 },
      { type: 'adjustCommanderCasts', playerId: 'p1', slot: 1, delta: 2 },
      { type: 'adjustCommanderDamage', targetId: 'p1', sourceId: 'p2', slot: 1, delta: 4 },
      { type: 'setMonarch', playerId: 'p2' },
      { type: 'setInitiative', playerId: 'p2' },
      { type: 'setConceded', playerId: 'p2', conceded: true },
      { type: 'renamePlayer', playerId: 'p2', name: 'q' },
      { type: 'setColor', playerId: 'p2', color: 'q' },
      { type: 'setPartner', playerId: 'p2', hasPartner: true },
      { type: 'clockStart', now: 10 },
      { type: 'clockNextTurn', now: 20 },
      { type: 'clockSetActive', playerId: 'p3', now: 30 },
      { type: 'clockPause', now: 40 },
      { type: 'newGame', players: setups(2), settings, now: 1 },
    ];
    let cur = s;
    for (const a of actions) {
      const before = JSON.stringify(cur);
      const next = reduce(cur, a);
      expect(JSON.stringify(cur)).toBe(before);
      cur = next;
    }
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('returns new nested objects on change (structural sharing only for untouched parts)', () => {
    const s = mk(3);
    const n = reduce(s, { type: 'adjustCommanderDamage', targetId: 'p1', sourceId: 'p2', slot: 0, delta: 1 });
    expect(n).not.toBe(s);
    expect(n.players[0]).not.toBe(s.players[0]);
    expect(n.players[0]!.commanderDamage).not.toBe(s.players[0]!.commanderDamage);
    expect(n.players[1]).toBe(s.players[1]);
  });
});

describe('eliminated holders lose monarch/initiative', () => {
  it('clears monarch when the holder drops to 0 life, keeps others', () => {
    let s = mk();
    s = reduce(s, { type: 'setMonarch', playerId: 'p1' });
    s = reduce(s, { type: 'setInitiative', playerId: 'p2' });
    s = reduce(s, { type: 'adjustLife', playerId: 'p1', delta: -40 });
    expect(s.monarch).toBeNull();
    expect(s.initiative).toBe('p2');
  });

  it('clears on poison, concede and commander damage', () => {
    let s = reduce(mk(), { type: 'setInitiative', playerId: 'p2' });
    s = reduce(s, { type: 'adjustPoison', playerId: 'p2', delta: 10 });
    expect(s.initiative).toBeNull();
    s = reduce(s, { type: 'setMonarch', playerId: 'p3' });
    s = reduce(s, { type: 'setConceded', playerId: 'p3', conceded: true });
    expect(s.monarch).toBeNull();
    s = reduce(s, { type: 'setMonarch', playerId: 'p4' });
    s = reduce(s, { type: 'adjustCommanderDamage', targetId: 'p4', sourceId: 'p1', slot: 0, delta: 21 });
    expect(s.monarch).toBeNull();
  });
});

describe('seating actions', () => {
  it('setSeating recomputes rotations and is undo-able', () => {
    const h0 = initHistory(mk(4));
    const h1 = dispatch(h0, { type: 'setSeating', seating: 'ends' });
    expect(h1.present.settings.seating).toBe('ends');
    expect(h1.present.players.map((p) => p.rotation)).toEqual([180, 180, 0, 0]);
    expect(undo(h1).present.players.map((p) => p.rotation)).toEqual([90, 270, 90, 270]);
  });
  it('setSeating overrides manual rotations; same seating with matching rotations is a no-op', () => {
    const s = mk(4);
    expect(reduce(s, { type: 'setSeating', seating: 'sides' })).toBe(s);
    const rotated = reduce(s, { type: 'rotatePlayer', playerId: 'p1' });
    const back = reduce(rotated, { type: 'setSeating', seating: 'sides' });
    expect(back.players.map((p) => p.rotation)).toEqual([90, 270, 90, 270]);
  });
  it('rotatePlayer adds 90 modulo 360; unknown id is a no-op', () => {
    let s = mk(2); // [180, 0]
    s = reduce(s, { type: 'rotatePlayer', playerId: 'p1' });
    expect(get(s, 'p1').rotation).toBe(270);
    s = reduce(s, { type: 'rotatePlayer', playerId: 'p1' });
    expect(get(s, 'p1').rotation).toBe(0);
    s = reduce(s, { type: 'rotatePlayer', playerId: 'p2' });
    expect(get(s, 'p2').rotation).toBe(90);
    expect(reduce(s, { type: 'rotatePlayer', playerId: 'zz' })).toBe(s);
  });
});
