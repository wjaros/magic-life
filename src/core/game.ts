import { createClock, nextTurn, pause, setActive, start } from './clockAdapter';
import { alivePlayers, lossReason } from './rules';
import { MAX_PINNED } from './types';
import type {
  Action, BuiltinCounter, CustomCounter, GameSettings, GameState, PinKey, Player, PlayerId,
  PlayerSetup, Rotation,
} from './types';

export const BUILTIN_COUNTERS: readonly BuiltinCounter[] = ['energy', 'experience', 'poison', 'tax'];
export const MAX_COUNTER_NAME = 24;

const isBuiltin = (k: string): k is BuiltinCounter =>
  (BUILTIN_COUNTERS as readonly string[]).includes(k);

/** Trimmed and capped; '' when unusable. */
export function cleanCounterName(name: string): string {
  return Array.from(name.trim()).slice(0, MAX_COUNTER_NAME).join('').trim();
}

function nextCounterId(counters: CustomCounter[]): string {
  let max = 0;
  for (const c of counters) {
    const m = /^c(\d+)$/.exec(c.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `c${max + 1}`;
}

function sanitizePinned(keys: readonly PinKey[], counters: CustomCounter[]): PinKey[] {
  const out: PinKey[] = [];
  for (const k of keys) {
    if (out.includes(k)) continue;
    if (isBuiltin(k) || counters.some((c) => c.id === k)) out.push(k);
  }
  return out.slice(0, MAX_PINNED);
}

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
    const customCounters: CustomCounter[] = [];
    for (const raw of setup.customCounters ?? []) {
      const name = cleanCounterName(raw);
      if (name) customCounters.push({ id: nextCounterId(customCounters), name, value: 0 });
    }
    const pinned = sanitizePinned(
      [...(setup.pinned ?? []), ...customCounters.map((c) => c.id)],
      customCounters,
    );
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
      customCounters,
      pinned,
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

/** A player who has lost the game can no longer hold the monarch or initiative. */
function clearLostHolders(state: GameState): GameState {
  const lost = (id: PlayerId | null) => {
    if (id === null) return false;
    const p = state.players.find((x) => x.id === id);
    return p !== undefined && lossReason(p) !== null;
  };
  const m = lost(state.monarch);
  const i = lost(state.initiative);
  if (!m && !i) return state;
  return { ...state, monarch: m ? null : state.monarch, initiative: i ? null : state.initiative };
}

export function reduce(state: GameState, action: Action): GameState {
  const next = reduceInner(state, action);
  return next === state ? state : clearLostHolders(next);
}

function reduceInner(state: GameState, action: Action): GameState {
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

    case 'setPinned':
      return mapPlayer(state, action.playerId, (p) => {
        const pinned = sanitizePinned(action.pinned, p.customCounters);
        return pinned.length === p.pinned.length && pinned.every((k, i) => k === p.pinned[i])
          ? p
          : { ...p, pinned };
      });
    case 'addCustomCounter':
      return mapPlayer(state, action.playerId, (p) => {
        const name = cleanCounterName(action.name);
        if (!name) return p;
        const id = nextCounterId(p.customCounters);
        return {
          ...p,
          customCounters: [...p.customCounters, { id, name, value: 0 }],
          pinned: p.pinned.length < MAX_PINNED ? [...p.pinned, id] : p.pinned,
        };
      });
    case 'renameCustomCounter':
      return mapPlayer(state, action.playerId, (p) => {
        const name = cleanCounterName(action.name);
        const c = p.customCounters.find((x) => x.id === action.counterId);
        if (!name || !c || c.name === name) return p;
        return {
          ...p,
          customCounters: p.customCounters.map((x) => (x === c ? { ...x, name } : x)),
        };
      });
    case 'removeCustomCounter':
      return mapPlayer(state, action.playerId, (p) => {
        if (!p.customCounters.some((x) => x.id === action.counterId)) return p;
        return {
          ...p,
          customCounters: p.customCounters.filter((x) => x.id !== action.counterId),
          pinned: p.pinned.filter((k) => k !== action.counterId),
        };
      });
    case 'adjustCustomCounter':
      return mapPlayer(state, action.playerId, (p) => {
        const c = p.customCounters.find((x) => x.id === action.counterId);
        if (!c) return p;
        const v = nonNeg(c.value + action.delta);
        if (v === c.value) return p;
        return {
          ...p,
          customCounters: p.customCounters.map((x) => (x === c ? { ...x, value: v } : x)),
        };
      });

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
