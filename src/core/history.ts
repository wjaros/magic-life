import { reduce } from './game';
import type { Action, GameState, History } from './types';

export const HISTORY_CAP = 200;

/**
 * Clock actions are NOT undoable: they apply to `present` only, without touching
 * past/future, so undo never rewinds time. Because undo/redo restore whole states,
 * the live clock of the current present is carried over onto the restored state.
 * `newGame` starts a fresh history (past/future cleared).
 * No-op actions (state returned unchanged) are not recorded.
 */
const isClockAction = (a: Action) =>
  a.type === 'clockStart' ||
  a.type === 'clockPause' ||
  a.type === 'clockNextTurn' ||
  a.type === 'clockSetActive' ||
  a.type === 'pickFirstPlayer';

export function initHistory(state: GameState): History {
  return { past: [], present: state, future: [] };
}

export const MERGE_WINDOW_MS = 1500;

/** Actions on the same target within the window collapse into one undo step. */
function mergeKey(a: Action): string | null {
  switch (a.type) {
    case 'adjustLife': return `life:${a.playerId}`;
    case 'adjustPoison': return `poison:${a.playerId}`;
    case 'adjustCommanderDamage': return `cmd:${a.targetId}:${a.sourceId}:${a.slot}`;
    case 'adjustCustomCounter': return `custom:${a.playerId}:${a.counterId}`;
    default: return null;
  }
}

// Merge bookkeeping lives outside the History contract (which has no room for it).
// Keyed by the History object that resulted from the last mergeable action.
const lastMerge = new WeakMap<History, { key: string; at: number }>();

export function dispatch(history: History, action: Action, at: number = Date.now()): History {
  if (action.type === 'newGame') return initHistory(reduce(history.present, action));
  const next = reduce(history.present, action);
  if (isClockAction(action)) {
    const res = { ...history, present: next };
    const m = lastMerge.get(history);
    if (m) lastMerge.set(res, m);
    return res;
  }
  if (next === history.present) return history;
  const key = mergeKey(action);
  const prev = lastMerge.get(history);
  let res: History;
  if (key !== null && prev && prev.key === key && at - prev.at <= MERGE_WINDOW_MS && history.past.length > 0) {
    res = { past: history.past, present: next, future: [] };
  } else {
    const past = [...history.past, history.present];
    if (past.length > HISTORY_CAP) past.splice(0, past.length - HISTORY_CAP);
    res = { past, present: next, future: [] };
  }
  if (key !== null) lastMerge.set(res, { key, at });
  return res;
}

export function undo(history: History): History {
  const prev = history.past[history.past.length - 1];
  if (!prev) return history;
  return {
    past: history.past.slice(0, -1),
    present: { ...prev, clock: history.present.clock },
    future: [history.present, ...history.future],
  };
}

export function redo(history: History): History {
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past, history.present],
    present: { ...next, clock: history.present.clock },
    future: history.future.slice(1),
  };
}
