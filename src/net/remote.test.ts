import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../core/game';
import { createRemote, REMOTE_STORAGE_KEY } from './remote';

class FakeWS {
  static instances: FakeWS[] = [];
  static OPEN = 1;
  readyState = 0;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeWS.instances.push(this); }
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  recv(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
  of(t: string) { return this.sent.filter((m) => m.t === t); }
}

const game = createGame(
  [{ name: 'A', color: '#f00' }, { name: 'B', color: '#0f0' }],
  { startingLife: 40, turnLimitMs: null },
  1000,
);
const ID = 'client-abcdefgh';
const mk = () => createRemote({ url: 'ws://x/ws', clientId: ID, WebSocketImpl: FakeWS as unknown as typeof WebSocket });
const ids = game.players.map((p) => p.id);

beforeEach(() => { FakeWS.instances = []; sessionStorage.clear(); localStorage.clear(); });
afterEach(() => vi.useRealTimers());

describe('remote', () => {
  it('joins on open and claims the desired seat after joined', () => {
    const r = mk();
    r.start('abcde', ids[1], 'Ola');
    const ws = FakeWS.instances[0];
    ws.open();
    expect(ws.sent[0]).toEqual({ t: 'join', room: 'ABCDE', clientId: ID, name: 'Ola' });
    ws.recv({ t: 'joined', room: 'ABCDE' });
    expect(ws.of('claim')).toEqual([{ t: 'claim', playerId: ids[1] }]);
    ws.recv({ t: 'hostStatus', online: true });
    expect(ws.of('claim')).toHaveLength(1);
    expect(r.joined.value).toBe(true);
    r.leave();
  });

  it('derives mySeat, clockOffset and game from state', () => {
    const r = mk();
    r.start('ABCDE', ids[0]);
    const ws = FakeWS.instances[0];
    ws.open();
    ws.recv({ t: 'joined', room: 'ABCDE' });
    ws.recv({ t: 'state', state: game, seats: { [ids[0]]: ID, [ids[1]]: null }, hostNow: Date.now() + 5000 });
    expect(r.mySeat.value).toBe(ids[0]);
    expect(r.game.value).toEqual(game);
    expect(Math.abs(r.clockOffset.value - 5000)).toBeLessThan(200);
    expect(Math.abs(r.hostTime() - (Date.now() + 5000))).toBeLessThan(200);
    expect(JSON.parse(localStorage.getItem(REMOTE_STORAGE_KEY)!)).toMatchObject({ room: 'ABCDE', seat: ids[0] });
    r.leave();
  });

  it('re-joins and re-claims after reconnect', () => {
    vi.useFakeTimers();
    const r = mk();
    r.start('ABCDE', ids[1]);
    const ws = FakeWS.instances[0];
    ws.open();
    ws.recv({ t: 'joined', room: 'ABCDE' });
    ws.recv({ t: 'state', state: game, seats: { [ids[1]]: ID }, hostNow: Date.now() });
    ws.close();
    expect(r.status.value).toBe('closed');
    vi.advanceTimersByTime(600);
    const ws2 = FakeWS.instances[1];
    ws2.open();
    expect(ws2.of('join')).toHaveLength(1);
    // Host restarted and forgot the seat.
    ws2.recv({ t: 'joined', room: 'ABCDE' });
    ws2.recv({ t: 'state', state: game, seats: {}, hostNow: Date.now() });
    expect(ws2.of('claim')).toEqual([{ t: 'claim', playerId: ids[1] }]);
    r.leave();
  });

  it('does not claim while host is offline, claims when it returns', () => {
    const r = mk();
    r.start('ABCDE', ids[0]);
    const ws = FakeWS.instances[0];
    ws.open();
    ws.recv({ t: 'joined', room: 'ABCDE' });
    ws.recv({ t: 'hostStatus', online: false });
    ws.sent.length = 0;
    ws.recv({ t: 'hostStatus', online: true });
    expect(ws.of('claim')).toHaveLength(1);
    r.leave();
  });

  it('records refusal and drops a desired seat that is not ours', () => {
    const r = mk();
    r.start('ABCDE', ids[0]);
    const ws = FakeWS.instances[0];
    ws.open();
    ws.recv({ t: 'joined', room: 'ABCDE' });
    ws.recv({ t: 'refused', reason: 'seat-taken' });
    expect(r.lastRefused.value).toBe('seat-taken');
    expect(r.desiredSeat.value).toBeNull();
    r.leave();
  });

  it('sends actions, undo and release; no-room stops and forgets', () => {
    const r = mk();
    r.start('ABCDE', ids[0]);
    const ws = FakeWS.instances[0];
    ws.open();
    r.act({ type: 'adjustLife', playerId: ids[0], delta: 1 });
    r.undo();
    r.release();
    expect(ws.sent.slice(1).map((m) => m.t)).toEqual(['action', 'undo', 'release']);
    ws.recv({ t: 'error', code: 'no-room' });
    expect(r.error.value).toBe('no-room');
    expect(r.status.value).toBe('closed');
    expect(localStorage.getItem(REMOTE_STORAGE_KEY)).toBeNull();
  });
});
