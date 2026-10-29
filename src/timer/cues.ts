// Sound-cue thresholds for the current turn. Pure: no DOM, no clock access.
export type Cue = 'minute' | 'tick' | 'countdown' | 'timeout';

const MINUTE_MS = 60_000;
/** Remaining-time window (ms) in which minute dings are replaced by the countdown cues. */
const WINDOW_MS = 30_000;
const PRIORITY: Record<Cue, number> = { minute: 0, tick: 1, countdown: 2, timeout: 3 };

function countdownCue(remainingSec: number): Cue | null {
  if (remainingSec === 0) return 'timeout';
  if (remainingSec >= 1 && remainingSec <= 5) return 'countdown';
  if (remainingSec === 10 || remainingSec === 20 || remainingSec === 30) return 'tick';
  return null;
}

/**
 * Cues whose threshold t satisfies prevTurnMs < t <= turnMs, in time order.
 * Every full minute of turn time gives 'minute', except inside the last 30 s before the limit.
 * With a limit: remaining 30/20/10 s = 'tick', 5..1 s = 'countdown', 0 = 'timeout'.
 * At most one cue per threshold instant (the strongest wins).
 */
export function cuesBetween(prevTurnMs: number, turnMs: number, limitMs: number | null): Cue[] {
  if (!(turnMs > prevTurnMs)) return [];
  const found = new Map<number, Cue>();
  const add = (t: number, cue: Cue) => {
    if (t <= 0 || t <= prevTurnMs || t > turnMs) return;
    const old = found.get(t);
    if (!old || PRIORITY[cue] > PRIORITY[old]) found.set(t, cue);
  };
  const first = Math.floor(prevTurnMs / MINUTE_MS) + 1;
  const last = Math.floor(turnMs / MINUTE_MS);
  for (let k = first; k <= last; k++) {
    const t = k * MINUTE_MS;
    if (limitMs != null && limitMs - t >= 0 && limitMs - t <= WINDOW_MS) continue;
    add(t, 'minute');
  }
  if (limitMs != null) {
    for (const r of [30, 20, 10, 5, 4, 3, 2, 1, 0]) {
      const cue = countdownCue(r);
      if (cue) add(limitMs - r * 1000, cue);
    }
  }
  return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
}
