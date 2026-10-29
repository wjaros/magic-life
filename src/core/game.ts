import { createClock, nextTurn, pause, setActive, start } from './clockAdapter';
import { alivePlayers } from './rules';
import type {
  Action, GameSettings, GameState, Player, PlayerId, PlayerSetup, Rotation,
} from './types';

/**
 * Seat rotation per player index, for a phone lying flat in the table center.
 * 180 = seat on the far side (reads upside down from the near side), 0 = near side,
 * 90/270 = left/right long sides. Must match the grid cells in src/ui/components/layout.ts.
 *   1: [0]
 *   2: [180, 0]
 *   3: [180, 90, 270]
 *   4: [90, 270, 90, 270]
 *   5: [90, 270, 90, 270, 0]
 *   6: [90, 270, 90, 270, 90, 270]
 * More than 6 players cycle through the 6-player table.
 */
export const ROTATIONS: Record<number, Rotation[]> = {
  1: [0],
  2: [180, 0],
  3: [180, 90, 270],
  4: [90, 270, 90, 270],
  5: [90, 270, 90, 270, 0],
  6: [90, 270, 90, 270, 90, 270],
};

export function rotationsFor(count: number): Rotation[] {
  const table = ROTATIONS[Math.min(Math.max(count, 1), 6)] ?? [0];
  return Array.from({ length: count }, (_, i) => table[i % table.length] ?? 0);
}

export function createGame(
  players: PlayerSetup[],
  settings: GameSettings,
  now: number,
): GameState {
  const ids = players.map((_, i) => `p${i + 1}`);
  const rotations = rotationsFor(players.length);
  const built: Player[] = players.map((setup, i) => {
    const commanderDamage: Record<PlayerId, [number, number]> = {};
    for (const other of ids) if (other !== ids[i]) commanderDamage[other] = [0, 0];
    return {
      id: ids[i] as PlayerId,
      name: setup.name,
      color: setup.color,
      life: settings.startingLife,
      poison: 0,
      commanderCasts: [0, 0],
      hasPartner: setup.hasPartner ?? false,
      energy: 0,
      experience: 0,
      commanderDamage,
      conceded: false,
      rotation: rotations[i] ?? 0,
    };
  });
  return {
    version: 1,
    settings: { ...settings },
    players: built,
    monarch: null,
    initiative: null,
    clock: createClock(ids, ids[0] ?? null),
    createdAt: now,
  };
}

const nonNeg = (n: number) => (n < 0 ? 0 : n);
const has = (state: GameState, id: PlayerId) => state.players.some((p) => p.id === id);

/** Applies fn to one player; unknown id or an unchanged player returns `state` itself. */
function mapPlayer(state: GameState, id: PlayerId, fn: (p: Player) => Player): GameState {
  let changed = false;
  const players = state.players.map((p) => {
    if (p.id !== id) return p;
    const np = fn(p);
    if (np !== p) changed = true;
    return np;
  });
  return changed ? { ...state, players } : state;
}

export function reduce(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'newGame':
      return createGame(action.players, action.settings, action.now);

    case 'adjustLife':
      return mapPlayer(state, action.playerId, (p) =>
        action.delta === 0 ? p : { ...p, life: p.life + action.delta },
      );
    case 'adjustPoison':
      return mapPlayer(state, action.playerId, (p) => {
        const v = nonNeg(p.poison + action.delta);
        return v === p.poison ? p : { ...p, poison: v };
      });
    case 'adjustEnergy':
      return mapPlayer(state, action.playerId, (p) => {
        const v = nonNeg(p.energy + action.delta);
        return v === p.energy ? p : { ...p, energy: v };
      });
    case 'adjustExperience':
      return mapPlayer(state, action.playerId, (p) => {
        const v = nonNeg(p.experience + action.delta);
        return v === p.experience ? p : { ...p, experience: v };
      });
    case 'adjustCommanderCasts':
      return mapPlayer(state, action.playerId, (p) => {
        const v = nonNeg(p.commanderCasts[action.slot] + action.delta);
        if (v === p.commanderCasts[action.slot]) return p;
        const casts: [number, number] = [...p.commanderCasts];
        casts[action.slot] = v;
        return { ...p, commanderCasts: casts };
      });

    case 'adjustCommanderDamage': {
      if (!has(state, action.sourceId) || action.sourceId === action.targetId) return state;
      return mapPlayer(state, action.targetId, (p) => {
        const current = p.commanderDamage[action.sourceId] ?? [0, 0];
        const old = current[action.slot];
        const next = nonNeg(old + action.delta);
        const applied = next - old; // effective delta after clamping at 0
        if (applied === 0) return p;
        const slots: [number, number] = [...current];
        slots[action.slot] = next;
        return {
          ...p,
          life: p.life - applied,
          commanderDamage: { ...p.commanderDamage, [action.sourceId]: slots },
        };
      });
    }

    case 'setMonarch':
      if (action.playerId !== null && !has(state, action.playerId)) return state;
      return state.monarch === action.playerId ? state : { ...state, monarch: action.playerId };
    case 'setInitiative':
      if (action.playerId !== null && !has(state, action.playerId)) return state;
      return state.initiative === action.playerId
        ? state
        : { ...state, initiative: action.playerId };

    case 'setConceded':
      return mapPlayer(state, action.playerId, (p) =>
        p.conceded === action.conceded ? p : { ...p, conceded: action.conceded },
      );
    case 'renamePlayer':
      return mapPlayer(state, action.playerId, (p) =>
        p.name === action.name ? p : { ...p, name: action.name },
      );
    case 'setColor':
      return mapPlayer(state, action.playerId, (p) =>
        p.color === action.color ? p : { ...p, color: action.color },
      );
    case 'setPartner':
      return mapPlayer(state, action.playerId, (p) =>
        p.hasPartner === action.hasPartner ? p : { ...p, hasPartner: action.hasPartner },
      );

    case 'clockStart':
      return { ...state, clock: start(state.clock, action.now) };
    case 'clockPause':
      return { ...state, clock: pause(state.clock, action.now) };
    case 'clockNextTurn':
      return {
        ...state,
        clock: nextTurn(
          state.clock,
          state.players.map((p) => p.id),
          alivePlayers(state).map((p) => p.id),
          action.now,
        ),
      };
    case 'clockSetActive':
      if (!has(state, action.playerId)) return state;
      return { ...state, clock: setActive(state.clock, action.playerId, action.now) };
  }
}
