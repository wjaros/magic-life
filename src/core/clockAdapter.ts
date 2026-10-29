// TEMP: replaced by re-export from ../timer/clock at integration
// Minimal pure, timestamp-based implementation of the ClockApi functions core needs.
import type { ClockState, PlayerId } from './types';

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

/** Folds the currently open segment (if running) into the accumulators. */
function fold(clock: ClockState, now: number): ClockState {
  if (!clock.running || clock.segmentStartedAt === null) return clock;
  const dt = Math.max(0, now - clock.segmentStartedAt);
  const playerElapsedMs = { ...clock.playerElapsedMs };
  if (clock.activePlayerId !== null) {
    playerElapsedMs[clock.activePlayerId] = (playerElapsedMs[clock.activePlayerId] ?? 0) + dt;
  }
  return {
    ...clock,
    gameElapsedMs: clock.gameElapsedMs + dt,
    turnElapsedMs: clock.turnElapsedMs + dt,
    playerElapsedMs,
    segmentStartedAt: now,
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

export function nextTurn(
  clock: ClockState,
  order: PlayerId[],
  alive: PlayerId[],
  now: number,
): ClockState {
  const folded = fold(clock, now);
  let next: PlayerId | null = folded.activePlayerId;
  const from = folded.activePlayerId === null ? -1 : order.indexOf(folded.activePlayerId);
  for (let i = 1; i <= order.length; i++) {
    const id = order[(from + i + order.length) % order.length];
    if (id !== undefined && alive.includes(id)) {
      next = id;
      break;
    }
  }
  return { ...folded, activePlayerId: next, turn: folded.turn + 1, turnElapsedMs: 0 };
}

export function setActive(clock: ClockState, playerId: PlayerId, now: number): ClockState {
  const folded = fold(clock, now);
  if (folded.activePlayerId === playerId) return folded;
  return { ...folded, activePlayerId: playerId, turnElapsedMs: 0 };
}
