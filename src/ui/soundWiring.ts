import { remote } from '../net/remote';
import { snapshot } from '../timer/clock';
import type { GameState } from '../core/types';
import { installAudioUnlock, playCue } from './sound';
import { startSoundScheduler, type CueSource } from './soundScheduler';
import { game } from './store';

function sourceFrom(g: GameState | null, now: number, onlyFor: string | null): CueSource | null {
  if (!g || !g.clock.running) return null;
  const c = g.clock;
  if (onlyFor !== null && c.activePlayerId !== onlyFor) return null;
  const s = snapshot(c, now, g.settings.turnLimitMs);
  return {
    key: `${g.createdAt}|${c.activePlayerId}|${c.turn}`,
    turnMs: s.turnMs,
    limitMs: g.settings.turnLimitMs,
  };
}

/** Host (table device): cues for whoever's turn it is. */
export function startHostSound(): void {
  installAudioUnlock();
  startSoundScheduler({ source: () => sourceFrom(game.peek(), Date.now(), null), play: playCue });
}

/** Phone: cues only during the phone owner's own turn, on the host's clock. */
export function startRemoteSound(): void {
  installAudioUnlock();
  startSoundScheduler({
    source: () => {
      const seat = remote.mySeat.peek();
      if (seat === null) return null;
      return sourceFrom(remote.game.peek() as GameState | null, remote.hostTime(), seat);
    },
    play: playCue,
  });
}
