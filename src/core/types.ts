// Shared contract between core, timer, storage and UI.
// Frozen after phase 0: changes go through the orchestrator only.

export type PlayerId = string;

/** Which commander of an opponent dealt the damage (partner support). */
export type CommanderSlot = 0 | 1;

export type Rotation = 0 | 90 | 180 | 270;

export interface Player {
  id: PlayerId;
  name: string;
  /** CSS color used for the player's panel. */
  color: string;
  life: number;
  poison: number;
  /** Times each of this player's commanders has been cast from the command zone. */
  commanderCasts: [number, number];
  hasPartner: boolean;
  energy: number;
  experience: number;
  /**
   * Commander damage RECEIVED by this player:
   * commanderDamage[sourcePlayerId][slot] = damage.
   */
  commanderDamage: Record<PlayerId, [number, number]>;
  /** Manually conceded / removed. Rule-based loss is derived in rules.ts. */
  conceded: boolean;
  /** Seat orientation of the panel on the table. */
  rotation: Rotation;
}

export interface GameSettings {
  startingLife: number;
  /** Optional per-turn limit in ms; null = no limit. */
  turnLimitMs: number | null;
}

export interface GameState {
  version: 1;
  settings: GameSettings;
  players: Player[];
  monarch: PlayerId | null;
  initiative: PlayerId | null;
  clock: ClockState;
  /** Epoch ms when the game was created. */
  createdAt: number;
}

export interface PlayerSetup {
  name: string;
  color: string;
  hasPartner?: boolean;
}

export type Action =
  | { type: 'newGame'; players: PlayerSetup[]; settings: GameSettings; now: number }
  | { type: 'adjustLife'; playerId: PlayerId; delta: number }
  | { type: 'adjustPoison'; playerId: PlayerId; delta: number }
  | { type: 'adjustEnergy'; playerId: PlayerId; delta: number }
  | { type: 'adjustExperience'; playerId: PlayerId; delta: number }
  | { type: 'adjustCommanderCasts'; playerId: PlayerId; slot: CommanderSlot; delta: number }
  /** Commander damage also changes life by the same amount (rules 903.10a). */
  | {
      type: 'adjustCommanderDamage';
      targetId: PlayerId;
      sourceId: PlayerId;
      slot: CommanderSlot;
      delta: number;
    }
  | { type: 'setMonarch'; playerId: PlayerId | null }
  | { type: 'setInitiative'; playerId: PlayerId | null }
  | { type: 'setConceded'; playerId: PlayerId; conceded: boolean }
  | { type: 'renamePlayer'; playerId: PlayerId; name: string }
  | { type: 'setColor'; playerId: PlayerId; color: string }
  | { type: 'setPartner'; playerId: PlayerId; hasPartner: boolean }
  | { type: 'clockStart'; now: number }
  | { type: 'clockPause'; now: number }
  | { type: 'clockNextTurn'; now: number }
  | { type: 'clockSetActive'; playerId: PlayerId; now: number };

/** Undo-able history: core keeps past states, UI only calls undo(). */
export interface History {
  past: GameState[];
  present: GameState;
  future: GameState[];
}

// ---- Clock (implemented in src/timer/clock.ts) ----

export interface ClockState {
  running: boolean;
  activePlayerId: PlayerId | null;
  /** Turn number, starts at 1. Increments on every nextTurn. */
  turn: number;
  /** Epoch ms of last start/resume; null when paused or never started. */
  segmentStartedAt: number | null;
  /** Total game ms accumulated in finished segments. */
  gameElapsedMs: number;
  /** Per-player ms accumulated in finished segments. */
  playerElapsedMs: Record<PlayerId, number>;
  /** Ms of the current turn accumulated in finished segments. */
  turnElapsedMs: number;
}

/** Derived, display-ready clock values at a moment in time. */
export interface ClockSnapshot {
  running: boolean;
  activePlayerId: PlayerId | null;
  turn: number;
  gameMs: number;
  turnMs: number;
  playerMs: Record<PlayerId, number>;
  /** true when settings.turnLimitMs is set and turnMs exceeds it. */
  overTurnLimit: boolean;
}
