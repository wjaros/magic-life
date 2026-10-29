import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';

const dir = mkdtempSync(join(tmpdir(), 'ml-static-'));
writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title>');
process.env.STATIC_DIR = dir;
const { start } = await import('./index.ts');

const PORT = 18000 + Math.floor(Math.random() * 1000);
let server: Awaited<ReturnType<typeof start>>;
before(() => { server = start(PORT); });
after(() => server.close());

type Msg = { t: string } & Record<string, any>;

function open(): Promise<{ ws: WebSocket; next: (t?: string) => Promise<Msg>; send: (m: object) => void }> {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const queue: Msg[] = [];
  const waiters: Array<() => void> = [];
  ws.on('message', (d) => { queue.push(JSON.parse(d.toString())); waiters.splice(0).forEach((w) => w()); });
  const next = async (t?: string): Promise<Msg> => {
    for (;;) {
      const i = queue.findIndex((m) => !t || m.t === t);
      if (i >= 0) return queue.splice(i, 1)[0];
      await new Promise<void>((r) => waiters.push(r));
    }
  };
  return new Promise((ok, fail) => {
    ws.once('open', () => ok({ ws, next, send: (m) => ws.send(JSON.stringify(m)) }));
    ws.once('error', fail);
  });
}

test('serves index.html with SPA fallback and healthz', async () => {
  const r = await fetch(`http://localhost:${PORT}/some/route`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<title>t<\/title>/);
  assert.equal((await fetch(`http://localhost:${PORT}/missing.js`)).status, 404);
  assert.equal((await fetch(`http://localhost:${PORT}/healthz`)).status, 200);
  const traversal = await (await fetch(`http://localhost:${PORT}/..%2f..%2f..%2fetc%2fpasswd`)).text();
  assert.doesNotMatch(traversal, /root:/);
});

test('host creates room, remote joins, state and actions flow both ways', async () => {
  const host = await open();
  host.send({ t: 'host' });
  const hosted = await host.next('hosted');
  assert.match(hosted.room, /^[A-Z2-9]{5}$/);

  const state = { version: 1, players: [{ id: 'p1' }] };
  host.send({ t: 'state', state, seats: { p1: null }, hostNow: 123 });

  const remote = await open();
  remote.send({ t: 'join', room: hosted.room.toLowerCase(), clientId: 'client-abc-123', name: 'Ania' });
  assert.equal((await remote.next('joined')).room, hosted.room);
  assert.deepEqual((await remote.next('state')).state, state);
  assert.deepEqual(await host.next('peer'), { t: 'peer', event: 'join', clientId: 'client-abc-123', name: 'Ania' });

  remote.send({ t: 'action', action: { type: 'adjustLife', playerId: 'p1', delta: -1 } });
  const fwd = await host.next('fromRemote');
  assert.equal(fwd.clientId, 'client-abc-123');
  assert.equal(fwd.msg.action.delta, -1);

  host.send({ t: 'toRemote', clientId: 'client-abc-123', msg: { t: 'refused', reason: 'seat-taken' } });
  assert.equal((await remote.next('refused')).reason, 'seat-taken');

  // Host drops and resumes with its token; remote is told about both.
  host.ws.close();
  assert.equal((await remote.next('hostStatus')).online, true); // from join
  assert.equal((await remote.next('hostStatus')).online, false);
  const host2 = await open();
  host2.send({ t: 'host', room: hosted.room, token: 'wrong' });
  assert.equal((await host2.next('error')).code, 'bad-token');
  const host3 = await open();
  host3.send({ t: 'host', room: hosted.room, token: hosted.token });
  assert.equal((await host3.next('hosted')).room, hosted.room);
  assert.equal((await host3.next('peer')).clientId, 'client-abc-123');
  assert.equal((await remote.next('hostStatus')).online, true);

  remote.ws.close(); host2.ws.close(); host3.ws.close();
});

test('host re-creates a vanished room under its old code and token (server restart)', async () => {
  const host = await open();
  host.send({ t: 'host', room: 'QWERT', token: 'tok_abcdefghijklmnop' });
  assert.deepEqual(await host.next('hosted'), { t: 'hosted', room: 'QWERT', token: 'tok_abcdefghijklmnop' });
  const remote = await open();
  remote.send({ t: 'join', room: 'QWERT', clientId: 'client-restart-1' });
  assert.equal((await remote.next('joined')).room, 'QWERT');
  remote.ws.close(); host.ws.close();
});

test('rejects unknown rooms and garbage', async () => {
  const c = await open();
  c.send({ t: 'join', room: 'ZZZZZ', clientId: 'client-xyz-999' });
  assert.equal((await c.next('error')).code, 'no-room');
  c.ws.send('not json');
  assert.equal((await c.next('error')).code, 'bad-message');
  c.send({ t: 'state', state: {} });
  assert.equal((await c.next('error')).code, 'bad-message');
  c.ws.close();
});
