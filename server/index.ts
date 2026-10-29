// Magic Life server: serves the built app (dist/) and relays remote-play messages on /ws.
// Rooms live in memory only; the host device is the source of truth for game state.
import { randomBytes, randomInt } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  MAX_MESSAGE_BYTES,
  PING_INTERVAL_MS,
  ROOM_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_HOST_GRACE_MS,
  isRoomCode,
  type ClientId,
  type ErrorCode,
  type HostToServer,
  type RemoteToServer,
  type ServerToHost,
  type ServerToRemote,
} from '../src/net/protocol.ts';

const PORT = Number(process.env.PORT ?? 8080);
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? 'dist');
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 500);
const MAX_REMOTES_PER_ROOM = 12;
/** Token bucket per socket: burst of 40, refills 20 msgs/s. */
const RATE_BURST = 40;
const RATE_PER_SEC = 20;

interface Room {
  code: string;
  token: string;
  host: WebSocket | null;
  remotes: Map<ClientId, WebSocket>;
  /** Last `state` frame, already serialized for remotes. */
  lastState: string | null;
  hostGoneAt: number | null;
}

const rooms = new Map<string, Room>();

// ---------- static files ----------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end(`ok rooms=${rooms.size}`);
    return;
  }
  let rel: string;
  try {
    rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = join(STATIC_DIR, rel);
  if (!file.startsWith(STATIC_DIR + sep) && file !== STATIC_DIR) {
    res.writeHead(403).end();
    return;
  }
  let st = statSync(file, { throwIfNoEntry: false });
  if (st?.isDirectory()) {
    file = join(file, 'index.html');
    st = statSync(file, { throwIfNoEntry: false });
  }
  if (!st?.isFile()) {
    // SPA fallback for navigations; real 404 for missing assets.
    if (extname(rel)) {
      res.writeHead(404).end();
      return;
    }
    file = join(STATIC_DIR, 'index.html');
    st = statSync(file, { throwIfNoEntry: false });
    if (!st?.isFile()) {
      res.writeHead(404).end();
      return;
    }
  }
  const ext = extname(file);
  const name = file.slice(file.lastIndexOf(sep) + 1);
  // Hashed assets are immutable; html, manifest and the service worker must revalidate.
  const cache = file.includes(`${sep}assets${sep}`)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'content-length': st.size,
    'cache-control': cache,
    'x-content-type-options': 'nosniff',
    ...(name === 'sw.js' ? { 'service-worker-allowed': '/' } : {}),
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}

// ---------- rooms ----------

function newRoomCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
}

function send(ws: WebSocket | null | undefined, msg: ServerToHost | ServerToRemote | string): void {
  if (ws && ws.readyState === ws.OPEN) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
}

function broadcast(room: Room, msg: ServerToRemote | string): void {
  const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const ws of room.remotes.values()) send(ws, data);
}

function sweepRooms(now: number): void {
  for (const [code, room] of rooms) {
    if (!room.host && room.hostGoneAt !== null && now - room.hostGoneAt > ROOM_HOST_GRACE_MS) {
      for (const ws of room.remotes.values()) {
        send(ws, { t: 'error', code: 'no-room' });
        ws.close(4000, 'room closed');
      }
      rooms.delete(code);
    }
  }
}

// ---------- sockets ----------

type Role =
  | { kind: 'none' }
  | { kind: 'host'; room: Room }
  | { kind: 'remote'; room: Room; clientId: ClientId };

function attach(ws: WebSocket): void {
  let role: Role = { kind: 'none' };
  let tokens = RATE_BURST;
  let lastRefill = Date.now();
  let alive = true;
  ws.on('pong', () => { alive = true; });
  const heartbeat = setInterval(() => {
    if (!alive) { ws.terminate(); return; }
    alive = false;
    ws.ping();
  }, PING_INTERVAL_MS);

  const fail = (code: ErrorCode, message?: string) => send(ws, { t: 'error', code, message });

  ws.on('message', (raw, isBinary) => {
    const now = Date.now();
    tokens = Math.min(RATE_BURST, tokens + ((now - lastRefill) / 1000) * RATE_PER_SEC);
    lastRefill = now;
    if (tokens < 1) return fail('rate-limited');
    tokens -= 1;
    if (isBinary) return fail('bad-message');
    let msg: { t?: unknown } & Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return fail('bad-message');
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return fail('bad-message');

    if (msg.t === 'ping') return send(ws, { t: 'pong' });

    if (role.kind === 'none') {
      if (msg.t === 'host') return onHost(msg as HostToServer & { t: 'host' });
      if (msg.t === 'join') return onJoin(msg as RemoteToServer & { t: 'join' });
      return fail('bad-message');
    }
    if (role.kind === 'host') return onHostMessage(role.room, msg as HostToServer);
    return onRemoteMessage(role.room, role.clientId, msg as RemoteToServer);
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    if (role.kind === 'host' && role.room.host === ws) {
      role.room.host = null;
      role.room.hostGoneAt = Date.now();
      broadcast(role.room, { t: 'hostStatus', online: false });
    } else if (role.kind === 'remote' && role.room.remotes.get(role.clientId) === ws) {
      role.room.remotes.delete(role.clientId);
      send(role.room.host, { t: 'peer', event: 'leave', clientId: role.clientId });
    }
  });

  function onHost(msg: { room?: unknown; token?: unknown }): void {
    let room: Room | undefined;
    const resumeCode = isRoomCode(msg.room) ? msg.room : undefined;
    const resumeToken = typeof msg.token === 'string' && /^[\w-]{16,64}$/.test(msg.token) ? msg.token : undefined;
    room = resumeCode ? rooms.get(resumeCode) : undefined;
    if (room) {
      if (room.token !== resumeToken) return fail('bad-token');
      if (room.host && room.host !== ws) room.host.close(4001, 'replaced by another host');
    } else {
      if (rooms.size >= MAX_ROOMS) return fail('server-full');
      // After a server restart the host re-creates its room under the same code and token,
      // so remotes can reconnect with the code they already have.
      const recreate = resumeCode && resumeToken;
      room = {
        code: recreate ? resumeCode : newRoomCode(),
        token: recreate ? resumeToken : randomBytes(18).toString('base64url'),
        host: null,
        remotes: new Map(),
        lastState: null,
        hostGoneAt: null,
      };
      rooms.set(room.code, room);
    }
    room.host = ws;
    room.hostGoneAt = null;
    role = { kind: 'host', room };
    send(ws, { t: 'hosted', room: room.code, token: room.token });
    for (const clientId of room.remotes.keys()) send(ws, { t: 'peer', event: 'join', clientId });
    broadcast(room, { t: 'hostStatus', online: true });
  }

  function onJoin(msg: { room?: unknown; clientId?: unknown; name?: unknown }): void {
    const code = typeof msg.room === 'string' ? msg.room.toUpperCase() : '';
    const room = isRoomCode(code) ? rooms.get(code) : undefined;
    if (!room) return fail('no-room');
    if (typeof msg.clientId !== 'string' || !/^[\w-]{8,64}$/.test(msg.clientId)) return fail('bad-message');
    const clientId = msg.clientId;
    const previous = room.remotes.get(clientId);
    if (!previous && room.remotes.size >= MAX_REMOTES_PER_ROOM) return fail('server-full');
    if (previous && previous !== ws) previous.close(4002, 'replaced by a newer connection');
    room.remotes.set(clientId, ws);
    role = { kind: 'remote', room, clientId };
    const name = typeof msg.name === 'string' ? msg.name.slice(0, 32) : undefined;
    send(ws, { t: 'joined', room: room.code });
    send(ws, { t: 'hostStatus', online: !!room.host });
    if (room.lastState) send(ws, room.lastState);
    send(room.host, { t: 'peer', event: 'join', clientId, name });
  }

  function onHostMessage(room: Room, msg: HostToServer): void {
    switch (msg.t) {
      case 'state': {
        const out: ServerToRemote = { t: 'state', state: msg.state, seats: msg.seats, hostNow: msg.hostNow };
        room.lastState = JSON.stringify(out);
        return broadcast(room, room.lastState);
      }
      case 'toRemote':
        return send(room.remotes.get(msg.clientId), msg.msg);
      case 'kick': {
        const target = room.remotes.get(msg.clientId);
        room.remotes.delete(msg.clientId);
        target?.close(4003, 'kicked');
        return;
      }
      default:
        return fail('bad-message');
    }
  }

  function onRemoteMessage(room: Room, clientId: ClientId, msg: RemoteToServer): void {
    if (msg.t === 'join') return fail('bad-message');
    if (!room.host) return send(ws, { t: 'hostStatus', online: false });
    send(room.host, { t: 'fromRemote', clientId, msg });
  }
}

// ---------- boot ----------

export function start(port = PORT) {
  const http = createServer(serveStatic);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  http.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => attach(ws));
  });
  const sweeper = setInterval(() => sweepRooms(Date.now()), 60_000);
  http.listen(port);
  return {
    http,
    close: () =>
      new Promise<void>((done) => {
        clearInterval(sweeper);
        for (const c of wss.clients) c.terminate();
        wss.close();
        http.close(() => done());
      }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
  console.log(`magic-life server on :${PORT}, static ${STATIC_DIR}`);
}
