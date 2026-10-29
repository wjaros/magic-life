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
  a.type === 'clockSetActive';

export function initHistory(state: GameState): History {
  return { past: [], present: state, future: [] };
}

export function dispatch(history: History, action: Action): History {
  if (action.type === 'newGame') return initHistory(reduce(history.present, action));
  const next = reduce(history.present, action);
  if (isClockAction(action)) return { ...history, present: next };
  if (next === history.present) return history;
  const past = [...history.past, history.present];
  if (past.length > HISTORY_CAP) past.splice(0, past.length - HISTORY_CAP);
  return { past, present: next, future: [] };
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
