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
    h = dispatch(h, { type: 'adjustLife', playerId: 'p1', delta: -1 });
    h = dispatch(h, { type: 'adjustLife', playerId: 'p1', delta: -1 });
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
      h = dispatch(h, { type: 'adjustLife', playerId: 'p1', delta: -1 });
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

  it('does not mutate the previous history object', () => {
    const h = mk();
    const snap = JSON.stringify(h);
    dispatch(h, { type: 'adjustLife', playerId: 'p1', delta: -1 });
    undo(dispatch(h, { type: 'adjustLife', playerId: 'p1', delta: -1 }));
    expect(JSON.stringify(h)).toBe(snap);
  });
});
