import type { GameState, Player } from './types';

export const POISON_LETHAL = 10;
export const COMMANDER_LETHAL = 21;

export type LossReason = null | 'life' | 'poison' | 'commander' | 'conceded';

/** Why the player has lost, or null if still in the game. */
export function lossReason(player: Player): LossReason {
  if (player.conceded) return 'conceded';
  if (player.life <= 0) return 'life';
  if (player.poison >= POISON_LETHAL) return 'poison';
  for (const slots of Object.values(player.commanderDamage)) {
    // Each slot is a distinct commander: damage is never summed across them.
    if (slots[0] >= COMMANDER_LETHAL || slots[1] >= COMMANDER_LETHAL) return 'commander';
  }
  return null;
}

export function alivePlayers(state: GameState): Player[] {
  return state.players.filter((p) => lossReason(p) === null);
}
