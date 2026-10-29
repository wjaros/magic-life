import { signal } from '@preact/signals';
import type { PlayerId } from '../core/types';
import { alivePlayers } from './engine';
import { act, game, vibrate } from './store';

/** Panel currently lit by the shuffle animation (UI-only). */
export const rollHighlight = signal<PlayerId | null>(null);
/** Panel showing the "Zaczynasz!" badge (UI-only). */
export const firstBadge = signal<PlayerId | null>(null);
/** True while the animation runs or the badge shows. */
export const rolling = signal(false);
/** createdAt of the game a starting player was already picked for (hides the big button). */
export const pickedFor = signal<number | null>(null);

export const BADGE_MS = 2000;

/** Uniform integer in [0, n) from crypto.getRandomValues (rejection sampling, no modulo bias). */
export function randomInt(n: number): number {
  if (n <= 1) return 0;
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  do crypto.getRandomValues(buf); while (buf[0]! >= limit);
  return buf[0]! % n;
}

/** Delay before step k of `steps`: quick start, then slowing down towards the end. */
export function stepDelay(k: number, steps: number): number {
  const t = k / steps;
  const slow = Math.max(0, (t - 0.25) / 0.75);
  return 70 + 180 * slow * slow + 60 * (1 - Math.min(1, t / 0.25));
}

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let timers: number[] = [];

export function cancelRoll(): void {
  timers.forEach(clearTimeout);
  timers = [];
  rollHighlight.value = null;
  firstBadge.value = null;
  rolling.value = false;
}

/** Picks the starting player at random among alive players and animates it. Ignored while rolling. */
export function rollFirstPlayer(): void {
  const g = game.peek();
  if (!g || rolling.peek()) return;
  const alive = alivePlayers(g).map((p) => p.id);
  if (alive.length === 0) return;
  const created = g.createdAt;
  const winnerIdx = randomInt(alive.length);
  const winner = alive[winnerIdx]!;
  rolling.value = true;
  firstBadge.value = null;

  const finish = () => {
    rollHighlight.value = null;
    if (game.peek()?.createdAt !== created) { cancelRoll(); return; }
    act({ type: 'pickFirstPlayer', playerId: winner, now: Date.now() });
    pickedFor.value = created;
    firstBadge.value = winner;
    vibrate(80);
    timers.push(window.setTimeout(() => {
      firstBadge.value = null;
      rolling.value = false;
    }, BADGE_MS));
  };

  if (reducedMotion() || alive.length === 1) { finish(); return; }

  const steps = 14 + randomInt(alive.length);
  let at = 0;
  for (let k = 1; k <= steps; k++) {
    at += stepDelay(k, steps);
    // Walk backwards from the winner so the last step always lands on it.
    const id = alive[(((winnerIdx - (steps - k)) % alive.length) + alive.length) % alive.length]!;
    timers.push(window.setTimeout(() => {
      if (game.peek()?.createdAt !== created) { cancelRoll(); return; }
      rollHighlight.value = id;
      vibrate(8);
    }, at));
  }
  timers.push(window.setTimeout(finish, at + 220));
}
