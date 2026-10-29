// Chess-clock engine. Pure: every function takes `now` (epoch ms) explicitly and
// returns a new ClockState / ClockSnapshot without mutating its inputs.
// Time is derived from timestamps, so it stays correct after the screen is locked.
import type { ClockSnapshot, ClockState, PlayerId } from '../core/types';

/** Ms of the running segment so far; 0 when paused or if `now` is before the segment start. */
function segmentMs(clock: ClockState, now: number): number {
  if (!clock.running || clock.segmentStartedAt === null) return 0;
  return Math.max(0, now - clock.segmentStartedAt);
}

/**
 * Folds the running segment into the counters (game, turn, active player).
 * Does not touch `running` or `segmentStartedAt`; callers decide that.
 */
function fold(clock: ClockState, now: number): ClockState {
  const delta = segmentMs(clock, now);
  if (delta === 0) return clock;
  const playerElapsedMs: Record<PlayerId, number> = { ...clock.playerElapsedMs };
  if (clock.activePlayerId !== null) {
    const id = clock.activePlayerId;
    playerElapsedMs[id] = (playerElapsedMs[id] ?? 0) + delta;
  }
  return {
    ...clock,
    gameElapsedMs: clock.gameElapsedMs + delta,
    turnElapsedMs: clock.turnElapsedMs + delta,
    playerElapsedMs,
  };
}

/** First id after `active` in `order` (wrapping) that is in `alive`; null if none. */
function pickNext(
  order: PlayerId[],
  alive: PlayerId[],
  active: PlayerId | null,
): PlayerId | null {
  const n = order.length;
  if (n === 0) return null;
  const aliveSet = new Set(alive);
  const from = active === null ? -1 : order.indexOf(active);
  for (let k = 1; k <= n; k++) {
    const id = order[(from + k) % n];
    if (aliveSet.has(id)) return id;
  }
  return null;
}

export function createClock(playerIds: PlayerId[], firstPlayerId: PlayerId | null): ClockState {
  const playerElapsedMs: Record<PlayerId, number> = {};
  for (const id of playerIds) playerElapsedMs[id] = 0;
  return {
    running: false,
    activePlayerId: firstPlayerId,
    turn: 1,
    segmentStartedAt: null,
    gameElapsedMs: 0,
    playerElapsedMs,
    turnElapsedMs: 0,
  };
}

export function start(clock: ClockState, now: number): ClockState {
  if (clock.running) return clock;
  return { ...clock, running: true, segmentStartedAt: now };
}

export function pause(clock: ClockState, now: number): ClockState {
  if (!clock.running) return clock;
  return { ...fold(clock, now), running: false, segmentStartedAt: null };
}

/**
 * Ends the current turn: folds the running segment, moves to the next alive player
 * in `order` (wrapping, skipping dead ids), increments `turn` and resets the turn timer.
 * If no alive player is found, the active player is left unchanged.
 */
export function nextTurn(
  clock: ClockState,
  order: PlayerId[],
  alive: PlayerId[],
  now: number,
): ClockState {
  const folded = fold(clock, now);
  const next = pickNext(order, alive, folded.activePlayerId);
  return {
    ...folded,
    activePlayerId: next ?? folded.activePlayerId,
    turn: folded.turn + 1,
    turnElapsedMs: 0,
    segmentStartedAt: folded.running ? now : folded.segmentStartedAt,
  };
}

/** Switches the active player without advancing the turn counter; resets the turn timer. */
export function setActive(clock: ClockState, playerId: PlayerId, now: number): ClockState {
  const folded = fold(clock, now);
  return {
    ...folded,
    activePlayerId: playerId,
    turnElapsedMs: 0,
    segmentStartedAt: folded.running ? now : folded.segmentStartedAt,
  };
}

/** Live, display-ready values at `now`. Turn-limit check uses `turnLimitMs` (null = none). */
export function snapshot(
  clock: ClockState,
  now: number,
  turnLimitMs: number | null,
): ClockSnapshot {
  const live = segmentMs(clock, now);
  const playerMs: Record<PlayerId, number> = {};
  for (const id of Object.keys(clock.playerElapsedMs)) {
    playerMs[id] = clock.playerElapsedMs[id] + (id === clock.activePlayerId ? live : 0);
  }
  if (clock.activePlayerId !== null && !(clock.activePlayerId in playerMs)) {
    playerMs[clock.activePlayerId] = live;
  }
  const turnMs = clock.turnElapsedMs + live;
  return {
    running: clock.running,
    activePlayerId: clock.activePlayerId,
    turn: clock.turn,
    gameMs: clock.gameElapsedMs + live,
    turnMs,
    playerMs,
    overTurnLimit: turnLimitMs != null && turnMs > turnLimitMs,
  };
}

/** "m:ss" under one hour, "h:mm:ss" otherwise. Negative or non-finite input shows as 0. */
export function formatMs(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  if (h === 0) return `${m}:${ss}`;
  return `${h}:${String(m).padStart(2, '0')}:${ss}`;
}
