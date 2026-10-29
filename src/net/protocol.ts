// Wire protocol between the table device (host), the relay server and players' phones (remotes).
// Frozen contract for the remote-play feature: changes go through the orchestrator only.
//
// Topology: host <-> server <-> remotes. The server only relays and caches the latest
// state; the host is authoritative (runs the reducer, owns undo history and the clock).
// Transport: one WebSocket per device at `${origin}/ws`, JSON text frames.

import type { Action, GameState, PlayerId } from '../core/types';

/** Room codes: 5 chars from an alphabet without look-alikes (no 0/O, 1/I/L). */
export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
export const MAX_MESSAGE_BYTES = 64 * 1024;
/** Server keeps a room this long after the host disconnects, so the host can resume. */
export const ROOM_HOST_GRACE_MS = 15 * 60 * 1000;
export const PING_INTERVAL_MS = 20_000;

/** Stable per-device id, generated once and kept in localStorage by the client. */
export type ClientId = string;

/** Which remote device controls which player. A player has at most one remote. */
export type Seats = Record<PlayerId, ClientId | null>;

// ---- host -> server ----
export type HostToServer =
  /** Create a room, or resume one after reconnect (room + token from an earlier `hosted`). */
  | { t: 'host'; room?: string; token?: string }
  /** Publish the authoritative state; server caches it and forwards to every remote. */
  | { t: 'state'; state: GameState; seats: Seats; hostNow: number }
  /** Answer a remote's request (e.g. a refused claim). */
  | { t: 'toRemote'; clientId: ClientId; msg: ServerToRemote }
  | { t: 'kick'; clientId: ClientId }
  | { t: 'ping' };

// ---- server -> host ----
export type ServerToHost =
  | { t: 'hosted'; room: string; token: string }
  | { t: 'peer'; event: 'join' | 'leave'; clientId: ClientId; name?: string }
  /** A remote's request, relayed verbatim with the sender's id attached by the server. */
  | { t: 'fromRemote'; clientId: ClientId; msg: RemoteToServer }
  | { t: 'error'; code: ErrorCode; message?: string }
  | { t: 'pong' };

// ---- remote -> server (forwarded to host as `fromRemote`, except join/ping) ----
export type RemoteToServer =
  | { t: 'join'; room: string; clientId: ClientId; name?: string }
  /** Take control of a player's tile. Host decides; answers via the next `state` (seats). */
  | { t: 'claim'; playerId: PlayerId }
  | { t: 'release' }
  /**
   * Request an action. Host only accepts actions that target the claimed player
   * (or clock actions when that player is active), and replaces any `now` with its own clock.
   */
  | { t: 'action'; action: Action }
  | { t: 'undo' }
  | { t: 'ping' };

// ---- server -> remote ----
export type ServerToRemote =
  | { t: 'joined'; room: string }
  /** Latest authoritative state. `hostNow` lets the remote compute clock offset. */
  | { t: 'state'; state: GameState; seats: Seats; hostNow: number }
  | { t: 'hostStatus'; online: boolean }
  | { t: 'refused'; reason: 'seat-taken' | 'not-your-player' | 'not-allowed' }
  | { t: 'error'; code: ErrorCode; message?: string }
  | { t: 'pong' };

export type ErrorCode =
  | 'no-room'
  | 'bad-token'
  | 'bad-message'
  | 'too-large'
  | 'rate-limited'
  | 'server-full';

/** Join URL encoded in the QR code. `seat` is optional pre-selection. */
export function joinUrl(origin: string, basePath: string, room: string, seat?: PlayerId): string {
  const u = new URL(basePath, origin);
  u.searchParams.set('join', room);
  if (seat) u.searchParams.set('seat', seat);
  return u.toString();
}

export function isRoomCode(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    s.length === ROOM_CODE_LENGTH &&
    [...s].every((c) => ROOM_ALPHABET.includes(c))
  );
}
