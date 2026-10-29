// WebSocket transport shared by host and remote: auto-reconnect with backoff, keepalive ping,
// and a status signal for the UI. Message typing comes from protocol.ts.
import { signal, type ReadonlySignal } from '@preact/signals';
import { PING_INTERVAL_MS } from './protocol';

export type ConnStatus = 'connecting' | 'open' | 'closed';

export interface Connection<In, Out> {
  status: ReadonlySignal<ConnStatus>;
  send(msg: Out): void;
  /** Returns an unsubscribe function. */
  onMessage(fn: (msg: In) => void): () => void;
  /** Stop for good (no reconnect). */
  close(): void;
}

export interface ConnectOptions<Out> {
  url: string;
  /** Messages to send on every (re)connect, e.g. host/join handshake. */
  hello: () => Out[];
  /** Test seam. */
  WebSocketImpl?: typeof WebSocket;
}

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];

export function connect<In, Out>(opts: ConnectOptions<Out>): Connection<In, Out> {
  const WS = opts.WebSocketImpl ?? WebSocket;
  const status = signal<ConnStatus>('connecting');
  const listeners = new Set<(msg: In) => void>();
  let ws: WebSocket | null = null;
  let attempt = 0;
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  const open = () => {
    if (stopped) return;
    status.value = 'connecting';
    const sock = new WS(opts.url);
    ws = sock;
    sock.onopen = () => {
      attempt = 0;
      status.value = 'open';
      for (const m of opts.hello()) sock.send(JSON.stringify(m));
      pingTimer = setInterval(() => sock.send('{"t":"ping"}'), PING_INTERVAL_MS);
    };
    sock.onmessage = (ev) => {
      let msg: In;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      for (const fn of listeners) fn(msg);
    };
    sock.onclose = () => {
      clearInterval(pingTimer);
      if (ws !== sock) return;
      ws = null;
      if (stopped) return;
      status.value = 'closed';
      const delay = BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)];
      retryTimer = setTimeout(open, delay);
    };
    sock.onerror = () => sock.close();
  };

  // Reconnect immediately when the phone comes back from sleep or regains network.
  const wake = () => {
    if (stopped || ws || document.visibilityState === 'hidden') return;
    clearTimeout(retryTimer);
    attempt = 0;
    open();
  };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('online', wake);

  open();

  return {
    status,
    send(msg) {
      if (ws && ws.readyState === WS.OPEN) ws.send(JSON.stringify(msg));
    },
    onMessage(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    close() {
      stopped = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      ws?.close();
      ws = null;
      status.value = 'closed';
    },
  };
}

/**
 * Relay endpoint. Defaults to `/ws` on the page's own origin (the Docker server serves both);
 * VITE_RELAY_URL overrides it, e.g. for a build hosted elsewhere.
 */
export function relayUrl(): string {
  const env = import.meta.env.VITE_RELAY_URL as string | undefined;
  if (env) return env;
  const u = new URL('ws', new URL(import.meta.env.BASE_URL, location.href));
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString();
}

/** True when a relay server answers next to the app (false on plain static hosting like GitHub Pages). */
export async function relayAvailable(): Promise<boolean> {
  if (import.meta.env.VITE_RELAY_URL) return true;
  try {
    const r = await fetch(new URL('healthz', new URL(import.meta.env.BASE_URL, location.href)), { cache: 'no-store' });
    return r.ok && (await r.text()).startsWith('ok');
  } catch {
    return false;
  }
}

/** Stable per-device id for the remote role. */
export function clientId(): string {
  const KEY = 'magic-life/clientId';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
