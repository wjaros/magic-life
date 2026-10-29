// Function signatures each module must export. Implementations live in their own folders.
import type {
  Action, ClockSnapshot, ClockState, GameSettings, GameState, History, Player, PlayerId,
} from './types';

export interface CoreApi {
  /** src/core/game.ts */
  createGame(players: import('./types').PlayerSetup[], settings: GameSettings, now: number): GameState;
  reduce(state: GameState, action: Action): GameState;
  /** src/core/history.ts — push/undo/redo; cosmetic actions may be merged. */
  initHistory(state: GameState): History;
  dispatch(history: History, action: Action): History;
  undo(history: History): History;
  redo(history: History): History;
  /** src/core/rules.ts */
  lossReason(player: Player): null | 'life' | 'poison' | 'commander' | 'conceded';
  alivePlayers(state: GameState): Player[];
}

export interface ClockApi {
  /** src/timer/clock.ts — all pure, all take `now` explicitly. */
  createClock(playerIds: PlayerId[], firstPlayerId: PlayerId | null): ClockState;
  start(clock: ClockState, now: number): ClockState;
  pause(clock: ClockState, now: number): ClockState;
  /** Advance to next player in `order`, skipping ids not in `alive`. */
  nextTurn(clock: ClockState, order: PlayerId[], alive: PlayerId[], now: number): ClockState;
  setActive(clock: ClockState, playerId: PlayerId, now: number): ClockState;
  snapshot(clock: ClockState, now: number, turnLimitMs: number | null): ClockSnapshot;
}

export interface StorageApi {
  /** src/storage/index.ts — localStorage key 'magic-life/v1'. Never throws. */
  save(history: History): void;
  load(): History | null;
  clear(): void;
}
