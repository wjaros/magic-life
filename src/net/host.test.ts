import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@preact/signals';
import { act, history, startGame, undoAct } from '../ui/store';
import type { Connection, ConnectOptions } from './connection';
import { authorize, createHost, HOST_STORAGE_KEY, STATE_MIN_INTERVAL_MS } from './host';
import type { HostToServer, RemoteToServer, ServerToHost } from './protocol';

function fakeConn() {
  const sent: HostToServer[] = [];
  const listeners = new Set<(m: ServerToHost) => void>();
  let opts!: ConnectOptions<HostToServer>;
  const status = signal<'connecting' | 'open' | 'closed'>('open');
  const conn: Connection<ServerToHost, HostToServer> = {
    status,
    send: (m) => { sent.push(m); },
    onMessage: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    close: vi.fn(),
  };
  return {
    sent,
    status,
    conn,
    connect: (o: ConnectOptions<HostToServer>) => { opts = o; return conn; },
    hello: () => opts.hello(),
    emit: (m: ServerToHost) => listeners.forEach((l) => l(m)),
    from: (clientId: string, msg: RemoteToServer) =>
      listeners.forEach((l) => l({ t: 'fromRemote', clientId, msg })),
    refusals: () =>
      sent.flatMap((m) => (m.t === 'toRemote' && m.msg.t === 'refused' ? [m.msg.reason] : [])),
    states: () => sent.filter((m) => m.t === 'state'),
  };
}

function setup() {
  const f = fakeConn();
  const h = createHost({ connect: f.connect, act, undo: undoAct, now: () => Date.now() });
  h.startHosting();
  f.emit({ t: 'hosted', room: 'ABCDE', token: 'tok'.repeat(8) });
  return { f, h };
}

const life = (id: string) => history.value!.present.players.find((p) => p.id === id)!.life;

beforeEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  startGame(
    [{ name: 'A', color: '#f00' }, { name: 'B', color: '#0f0' }, { name: 'C', color: '#00f' }],
    { startingLife: 40, turnLimitMs: null },
  );
});

describe('authorize', () => {
  const state = () => history.value!.present;
  it('allows own-player actions and rejects others', () => {
    expect(authorize({ type: 'adjustLife', playerId: 'p2', delta: -1 }, 'p2', state(), 5).ok).toBe(true);
    expect(authorize({ type: 'adjustLife', playerId: 'p1', delta: -1 }, 'p2', state(), 5)).toEqual({ ok: false, reason: 'not-your-player' });
    expect(authorize({ type: 'adjustLife', playerId: 'p2', delta: -1 }, null, state(), 5).ok).toBe(false);
  });
  it('commander damage is checked on the target', () => {
    const ok = authorize({ type: 'adjustCommanderDamage', targetId: 'p2', sourceId: 'p1', slot: 0, delta: 1 }, 'p2', state(), 5);
    expect(ok.ok).toBe(true);
    const bad = authorize({ type: 'adjustCommanderDamage', targetId: 'p1', sourceId: 'p2', slot: 0, delta: 1 }, 'p2', state(), 5);
    expect(bad.ok).toBe(false);
  });
  it('monarch: self or null only', () => {
    expect(authorize({ type: 'setMonarch', playerId: null }, 'p2', state(), 5).ok).toBe(true);
    expect(authorize({ type: 'setMonarch', playerId: 'p2' }, 'p2', state(), 5).ok).toBe(true);
    expect(authorize({ type: 'setInitiative', playerId: 'p3' }, 'p2', state(), 5).ok).toBe(false);
  });
  it('rejects host-only actions and junk', () => {
    expect(authorize({ type: 'setSeating', seating: 'ends' }, 'p2', state(), 5)).toEqual({ ok: false, reason: 'not-allowed' });
    expect(authorize({ type: 'newGame', players: [], settings: {}, now: 1 }, 'p2', state(), 5).ok).toBe(false);
    expect(authorize({ type: 'clockSetActive', playerId: 'p2', now: 1 }, 'p2', state(), 5).ok).toBe(false);
    expect(authorize({ type: 'adjustLife', playerId: 'p2', delta: NaN }, 'p2', state(), 5).ok).toBe(false);
    expect(authorize('x', 'p2', state(), 5).ok).toBe(false);
  });
  it('replaces now and gates nextTurn on the active player', () => {
    const v = authorize({ type: 'clockStart', now: 1 }, 'p2', state(), 999);
    expect(v.ok && v.action).toEqual({ type: 'clockStart', now: 999 });
    expect(authorize({ type: 'clockNextTurn', now: 1 }, 'p2', state(), 9).ok).toBe(false);
    const s = { ...state(), clock: { ...state().clock, activePlayerId: 'p2' } };
    expect(authorize({ type: 'clockNextTurn', now: 1 }, 'p2', s, 9).ok).toBe(true);
  });
});

describe('seats', () => {
  it('hello carries stored room and token; hosted persists them', () => {
    const { f } = setup();
    expect(JSON.parse(localStorage.getItem(HOST_STORAGE_KEY)!).room).toBe('ABCDE');
    expect(f.hello()).toEqual([{ t: 'host', room: 'ABCDE', token: 'tok'.repeat(8) }]);
  });

  it('claim grants a free seat, refuses a taken one, moves a client between seats', () => {
    const { f, h } = setup();
    f.from('c1', { t: 'claim', playerId: 'p2' });
    expect(h.seats.value).toEqual({ p1: null, p2: 'c1', p3: null });
    f.from('c2', { t: 'claim', playerId: 'p2' });
    expect(f.refusals()).toEqual(['seat-taken']);
    f.from('c1', { t: 'claim', playerId: 'p3' });
    expect(h.seats.value).toEqual({ p1: null, p2: null, p3: 'c1' });
    f.from('c1', { t: 'claim', playerId: 'nope' });
    expect(f.refusals().at(-1)).toBe('not-your-player');
    f.from('c1', { t: 'release' });
    expect(h.seats.value.p3).toBeNull();
  });

  it('peer leave keeps the seat; host can release it', () => {
    const { f, h } = setup();
    f.emit({ t: 'peer', event: 'join', clientId: 'c1', name: 'Ala' });
    f.from('c1', { t: 'claim', playerId: 'p1' });
    f.emit({ t: 'peer', event: 'leave', clientId: 'c1' });
    expect(h.seats.value.p1).toBe('c1');
    expect(h.peers.value.get('c1')).toEqual({ name: 'Ala', online: false });
    h.releaseSeat('p1');
    expect(h.seats.value.p1).toBeNull();
  });

  it('stopHosting clears stored room and seats', () => {
    const { f, h } = setup();
    f.from('c1', { t: 'claim', playerId: 'p1' });
    h.stopHosting();
    expect(localStorage.getItem(HOST_STORAGE_KEY)).toBeNull();
    expect(h.hosting.value).toBe(false);
    expect(h.seats.value).toEqual({});
  });

  it('a new host instance resumes seats from storage', () => {
    const a = setup();
    a.f.from('c1', { t: 'claim', playerId: 'p3' });
    const f2 = fakeConn();
    const h2 = createHost({ connect: f2.connect, act, undo: undoAct, now: () => Date.now() });
    h2.startHosting();
    expect(h2.seats.value.p3).toBe('c1');
    expect(h2.room.value).toBe('ABCDE');
    expect(f2.hello()[0]).toMatchObject({ t: 'host', room: 'ABCDE' });
  });
});

describe('actions', () => {
  it('applies allowed actions, refuses others', () => {
    const { f } = setup();
    f.from('c1', { t: 'claim', playerId: 'p2' });
    f.from('c1', { t: 'action', action: { type: 'adjustLife', playerId: 'p2', delta: -3 } });
    expect(life('p2')).toBe(37);
    f.from('c1', { t: 'action', action: { type: 'adjustLife', playerId: 'p1', delta: -3 } });
    expect(life('p1')).toBe(40);
    f.from('c1', { t: 'action', action: { type: 'setSeating', seating: 'ends' } });
    expect(f.refusals()).toEqual(['not-your-player', 'not-allowed']);
    f.from('c9', { t: 'action', action: { type: 'adjustLife', playerId: 'p1', delta: -3 } });
    expect(life('p1')).toBe(40);
  });

  it('undo only for the author of the last entry', () => {
    const { f } = setup();
    f.from('c1', { t: 'claim', playerId: 'p1' });
    f.from('c2', { t: 'claim', playerId: 'p2' });
    f.from('c1', { t: 'action', action: { type: 'adjustPoison', playerId: 'p1', delta: 1 } });
    f.from('c2', { t: 'action', action: { type: 'adjustEnergy', playerId: 'p2', delta: 1 } });
    f.from('c1', { t: 'undo' });
    expect(f.refusals()).toEqual(['not-allowed']);
    expect(history.value!.past.length).toBe(2);
    f.from('c2', { t: 'undo' });
    expect(history.value!.past.length).toBe(1);
    f.from('c1', { t: 'undo' });
    expect(history.value!.past.length).toBe(0);
    // a local (host) tap has no remote author
    act({ type: 'adjustPoison', playerId: 'p1', delta: 1 });
    f.from('c1', { t: 'undo' });
    expect(f.refusals().at(-1)).toBe('not-allowed');
  });
});

describe('state publishing', () => {
  it('sends on hosted and on peer join, throttles bursts and ends with the latest state', () => {
    vi.useFakeTimers();
    const { f } = setup();
    expect(f.states().length).toBe(1);
    f.emit({ t: 'peer', event: 'join', clientId: 'c1' });
    expect(f.states().length).toBe(2);
    for (let i = 0; i < 5; i++) act({ type: 'adjustLife', playerId: 'p1', delta: -1 });
    expect(f.states().length).toBeLessThanOrEqual(3);
    vi.advanceTimersByTime(STATE_MIN_INTERVAL_MS + 1);
    const last = f.states().at(-1) as Extract<HostToServer, { t: 'state' }>;
    expect(last.state.players[0].life).toBe(35);
    expect(f.states().length).toBeLessThanOrEqual(4);
  });
});
