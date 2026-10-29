// Single entry point from the UI to game logic and the clock.
export { createGame, reduce } from '../core/game';
export { initHistory, dispatch, undo, redo } from '../core/history';
export { lossReason, alivePlayers } from '../core/rules';
export { snapshot, formatMs } from '../timer/clock';
