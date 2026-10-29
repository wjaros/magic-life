import { describe, expect, it } from 'vitest';
import { createGame, reduce } from './game';
import { dispatch, initHistory, undo } from './history';
import type { GameSettings, GameState } from './types';

const settings: GameSettings = { startingLife: 40, turnLimitMs: null };
const mk = (n = 2) =>
  createGame(
    Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, color: `#00${i}` })),
    settings,
    0,
  );
const get = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;

describe('pinned and custom counters', () => {
  const withCounters = () =>
    createGame(
      [
        {
          name: 'a',
          color: 'x',
          pinned: ['energy', 'energy', 'bogus' as never],
          customCounters: ['  Skarby  ', '', 'x'.repeat(40)],
        },
        { name: 'b', color: 'y' },
      ],
      settings,
      0,
    );

  it('createGame builds custom counters and truncates pinned to MAX_PINNED', () => {
    const p = get(withCounters(), 'p1');
    expect(p.customCounters).toEqual([
      { id: 'c1', name: 'Skarby', value: 0 },
      { id: 'c2', name: 'x'.repeat(24), value: 0 },
    ]);
    expect(p.pinned).toEqual(['energy', 'c1']);
    expect(get(withCounters(), 'p2').pinned).toEqual([]);
    expect(get(withCounters(), 'p2').customCounters).toEqual([]);
  });

  it('setPinned keeps valid keys, dedupes and truncates', () => {
    let s = withCounters();
    s = reduce(s, { type: 'setPinned', playerId: 'p1', pinned: ['c2', 'c2', 'nope', 'tax', 'poison'] });
    expect(get(s, 'p1').pinned).toEqual(['c2', 'tax']);
    expect(reduce(s, { type: 'setPinned', playerId: 'p1', pinned: ['c2', 'tax'] })).toBe(s);
    expect(reduce(s, { type: 'setPinned', playerId: 'zz', pinned: [] })).toBe(s);
  });

  it('addCustomCounter appends, auto-pins only with room, ignores empty', () => {
    let s = mk();
    s = reduce(s, { type: 'addCustomCounter', playerId: 'p1', name: ' Storm ' });
    expect(get(s, 'p1').customCounters).toEqual([{ id: 'c1', name: 'Storm', value: 0 }]);
    expect(get(s, 'p1').pinned).toEqual(['c1']);
    s = reduce(s, { type: 'addCustomCounter', playerId: 'p1', name: 'B' });
    s = reduce(s, { type: 'addCustomCounter', playerId: 'p1', name: 'C' });
    expect(get(s, 'p1').customCounters.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(get(s, 'p1').pinned).toEqual(['c1', 'c2']);
    expect(reduce(s, { type: 'addCustomCounter', playerId: 'p1', name: '   ' })).toBe(s);
    expect(reduce(s, { type: 'addCustomCounter', playerId: 'zz', name: 'x' })).toBe(s);
  });

  it('rename, remove and adjust', () => {
    let s = reduce(mk(), { type: 'addCustomCounter', playerId: 'p1', name: 'A' });
    s = reduce(s, { type: 'renameCustomCounter', playerId: 'p1', counterId: 'c1', name: 'Nowa' });
    expect(get(s, 'p1').customCounters[0]!.name).toBe('Nowa');
    expect(reduce(s, { type: 'renameCustomCounter', playerId: 'p1', counterId: 'c1', name: ' ' })).toBe(s);
    expect(reduce(s, { type: 'renameCustomCounter', playerId: 'p1', counterId: 'c9', name: 'q' })).toBe(s);
    s = reduce(s, { type: 'adjustCustomCounter', playerId: 'p1', counterId: 'c1', delta: 3 });
    expect(get(s, 'p1').customCounters[0]!.value).toBe(3);
    s = reduce(s, { type: 'adjustCustomCounter', playerId: 'p1', counterId: 'c1', delta: -10 });
    expect(get(s, 'p1').customCounters[0]!.value).toBe(0);
    expect(reduce(s, { type: 'adjustCustomCounter', playerId: 'p1', counterId: 'c1', delta: -1 })).toBe(s);
    expect(reduce(s, { type: 'adjustCustomCounter', playerId: 'p1', counterId: 'c9', delta: 1 })).toBe(s);
    s = reduce(s, { type: 'removeCustomCounter', playerId: 'p1', counterId: 'c1' });
    expect(get(s, 'p1').customCounters).toEqual([]);
    expect(get(s, 'p1').pinned).toEqual([]);
    expect(reduce(s, { type: 'removeCustomCounter', playerId: 'p1', counterId: 'c1' })).toBe(s);
  });

  it('ids stay unique after removal', () => {
    let s = mk();
    for (const n of ['A', 'B']) s = reduce(s, { type: 'addCustomCounter', playerId: 'p1', name: n });
    s = reduce(s, { type: 'removeCustomCounter', playerId: 'p1', counterId: 'c1' });
    s = reduce(s, { type: 'addCustomCounter', playerId: 'p1', name: 'C' });
    expect(get(s, 'p1').customCounters.map((c) => c.id)).toEqual(['c2', 'c3']);
  });
});

describe('history: custom counters', () => {
  const base = () =>
    dispatch(initHistory(mk()), { type: 'addCustomCounter', playerId: 'p1', name: 'S' }, 0);
  type H = ReturnType<typeof base>;
  const adj = (h: H, at: number) =>
    dispatch(h, { type: 'adjustCustomCounter', playerId: 'p1', counterId: 'c1', delta: 1 }, at);
  const val = (h: H) => h.present.players[0]!.customCounters[0]!.value;

  it('merges rapid adjusts into one undo step', () => {
    let h = adj(base(), 10);
    h = adj(h, 200);
    h = adj(h, 400);
    expect(val(h)).toBe(3);
    expect(val(undo(h))).toBe(0);
  });

  it('does not merge after the window', () => {
    let h = adj(base(), 10);
    h = adj(h, 5000);
    expect(val(undo(h))).toBe(1);
  });

  it('no-op adjust returns same history', () => {
    const h = base();
    expect(
      dispatch(h, { type: 'adjustCustomCounter', playerId: 'p1', counterId: 'c1', delta: -1 }, 5),
    ).toBe(h);
  });
});
