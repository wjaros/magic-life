import { describe, expect, it } from 'vitest';
import { createGame } from './game';
import { dispatch, HISTORY_CAP, initHistory, redo, undo } from './history';

const mk = () =>
  initHistory(
    createGame(
      [
        { name: 'a', color: 'x' },
        { name: 'b', color: 'y' },
      ],
      { startingLife: 40, turnLimitMs: null },
      0,
    ),
  );
const life = (h: ReturnType<typeof mk>, id = 'p1') => h.present.players.find((p) => p.id === id)!.life;

describe('history', () => {
  it('initHistory starts empty', () => {
    const h = mk();
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);
  });

  it('dispatch pushes past and clears future', () => {
    let h = dispatch(mk(), { type: 'adjustLife', playerId: 'p1', delta: -1 });
    expect(h.past).toHaveLength(1);
    expect(life(h)).toBe(39);
    h = undo(h);
    expect(h.future).toHaveLength(1);
    h = dispatch(h, { type: 'adjustLife', playerId: 'p1', delta: -2 });
    expect(h.future).toEqual([]);
    expect(life(h)).toBe(38);
  });

  it('undo and redo round-trip', () => {
    let h = mk();
    h = dispatch(h, { type: 'adjustLife', playerId: 'p1', delta: -1 }, 0);
    h = dispatch(h, { type: 'adjustLife', playerId: 'p1', delta: -1 }, 5000);
    h = undo(h);
    expect(life(h)).toBe(39);
    h = undo(h);
    expect(life(h)).toBe(40);
    h = redo(h);
    h = redo(h);
    expect(life(h)).toBe(38);
  });

  it('undo/redo on empty stacks return the same history', () => {
    const h = mk();
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it('no-op actions are not recorded', () => {
    const h = mk();
    expect(dispatch(h, { type: 'adjustLife', playerId: 'nope', delta: 1 })).toBe(h);
    expect(dispatch(h, { type: 'adjustLife', playerId: 'p1', delta: 0 })).toBe(h);
  });

  it('caps past at 200, dropping the oldest', () => {
    let h = mk();
    for (let i = 0; i < HISTORY_CAP + 50; i++) {
      h = dispatch(h, { type: 'adjustLife', playerId: 'p1', delta: -1 }, i * 10_000);
    }
    expect(HISTORY_CAP).toBe(200);
    expect(h.past).toHaveLength(200);
    expect(life(h)).toBe(40 - 250);
    // oldest remaining state is the one before action #51
    expect(h.past[0]!.players[0]!.life).toBe(40 - 50);
    for (let i = 0; i < 300; i++) h = undo(h);
    expect(life(h)).toBe(40 - 50);
  });

  it('clock actions do not touch past/future and are not undone', () => {
    let h = dispatch(mk(), { type: 'adjustLife', playerId: 'p1', delta: -3 });
    h = dispatch(h, { type: 'clockStart', now: 100 });
    h = dispatch(h, { type: 'clockNextTurn', now: 600 });
    expect(h.past).toHaveLength(1);
    h = dispatch(h, { type: 'clockSetActive', playerId: 'p1', now: 700 });
    h = dispatch(h, { type: 'clockPause', now: 900 });
    expect(h.past).toHaveLength(1);
    const clock = h.present.clock;
    h = undo(h);
    expect(life(h)).toBe(40);
    expect(h.present.clock).toBe(clock);
    h = redo(h);
    expect(life(h)).toBe(37);
    expect(h.present.clock).toBe(clock);
  });

  it('clock actions keep the redo stack', () => {
    let h = dispatch(mk(), { type: 'adjustLife', playerId: 'p1', delta: -3 });
    h = undo(h);
    h = dispatch(h, { type: 'clockStart', now: 1 });
    expect(h.future).toHaveLength(1);
  });

  it('newGame resets history', () => {
    let h = dispatch(mk(), { type: 'adjustLife', playerId: 'p1', delta: -3 });
    h = undo(h);
    h = dispatch(h, {
      type: 'newGame',
      players: [{ name: 'z', color: 'c' }],
      settings: { startingLife: 20, turnLimitMs: null },
      now: 5,
    });
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);
    expect(h.present.players).toHaveLength(1);
  });

  describe('merging', () => {
    const adj = (delta: number, playerId = 'p1') => ({ type: 'adjustLife', playerId, delta }) as const;

    it('collapses rapid same-target life changes into one undo step', () => {
      let h = dispatch(mk(), adj(-1), 1000);
      h = dispatch(h, adj(-1), 1500);
      h = dispatch(h, adj(-10), 2900); // within 1500 ms of the previous action
      expect(h.past).toHaveLength(1);
      expect(life(h)).toBe(28);
      expect(life(undo(h))).toBe(40);
    });

    it('does not merge after the window, for another target, or another action type', () => {
      let h = dispatch(mk(), adj(-1), 1000);
      h = dispatch(h, adj(-1), 2501);
      expect(h.past).toHaveLength(2);
      h = dispatch(h, adj(-1, 'p2'), 2600);
      expect(h.past).toHaveLength(3);
      h = dispatch(h, { type: 'adjustPoison', playerId: 'p2', delta: 1 }, 2700);
      expect(h.past).toHaveLength(4);
    });

    it('merges poison and per-slot commander damage', () => {
      let h = dispatch(mk(), { type: 'adjustPoison', playerId: 'p1', delta: 1 }, 0);
      h = dispatch(h, { type: 'adjustPoison', playerId: 'p1', delta: 1 }, 100);
      expect(h.past).toHaveLength(1);
      const cd = (slot: 0 | 1) =>
        ({ type: 'adjustCommanderDamage', targetId: 'p1', sourceId: 'p2', slot, delta: 1 }) as const;
      h = dispatch(h, cd(0), 200);
      h = dispatch(h, cd(0), 300);
      expect(h.past).toHaveLength(2);
      h = dispatch(h, cd(1), 400);
      expect(h.past).toHaveLength(3);
    });

    it('clock actions in between do not break the merge; undo does', () => {
      let h = dispatch(mk(), adj(-1), 0);
      h = dispatch(h, { type: 'clockStart', now: 10 }, 10);
      h = dispatch(h, adj(-1), 100);
      expect(h.past).toHaveLength(1);
      h = undo(dispatch(h, adj(-1), 200));
      h = dispatch(h, adj(-1), 300);
      expect(h.past).toHaveLength(1);
    });
  });

  it('does not mutate the previous history object', () => {
    const h = mk();
    const snap = JSON.stringify(h);
    dispatch(h, { type: 'adjustLife', playerId: 'p1', delta: -1 });
    undo(dispatch(h, { type: 'adjustLife', playerId: 'p1', delta: -1 }));
    expect(JSON.stringify(h)).toBe(snap);
  });
});
