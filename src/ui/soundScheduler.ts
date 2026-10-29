// Polls the turn clock and plays sound cues as thresholds are crossed.
import { cuesBetween, type Cue } from '../timer/cues';

export interface CueSource {
  /** Identity of the current turn/run (active player, turn, game). A change resets tracking. */
  key: string;
  turnMs: number;
  limitMs: number | null;
}

export interface SchedulerOptions {
  /** Return null when no cues should play (paused, not my turn, no game). */
  source: () => CueSource | null;
  play: (cue: Cue) => void;
  intervalMs?: number;
  /** Crossings older than this are dropped (tab was throttled in the background). */
  maxLagMs?: number;
}

export interface Scheduler {
  tick(): void;
  stop(): void;
}

export function startSoundScheduler(opts: SchedulerOptions): Scheduler {
  const maxLag = opts.maxLagMs ?? 1500;
  let prev: number | null = null;
  let key: string | null = null;

  const tick = () => {
    const s = opts.source();
    if (!s) { prev = null; key = null; return; }
    if (s.key !== key || prev === null) {
      key = s.key;
      prev = s.turnMs;
      return;
    }
    const from = Math.max(prev, s.turnMs - maxLag);
    const cues = cuesBetween(from, s.turnMs, s.limitMs);
    prev = s.turnMs;
    const last = cues[cues.length - 1];
    if (last) opts.play(last);
  };

  const id = setInterval(tick, opts.intervalMs ?? 200);
  return { tick, stop: () => clearInterval(id) };
}
