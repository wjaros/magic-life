import { computed, effect, signal } from '@preact/signals';
import type { Action, ClockSnapshot, GameSettings, GameState, History, PlayerSetup } from '../core/types';
import { createGame, dispatch, initHistory, redo, snapshot, undo } from './engine';

/** Single source of truth. Persistence can subscribe via `onHistoryChange` or read `history` directly. */
export const history = signal<History | null>(null);
export const screen = signal<'setup' | 'game'>('setup');
/** Wall clock for display only; ticks every 250ms while the game clock runs. */
export const now = signal(Date.now());

export const game = computed<GameState | null>(() => history.value?.present ?? null);
export const canUndo = computed(() => (history.value?.past.length ?? 0) > 0);
export const canRedo = computed(() => (history.value?.future.length ?? 0) > 0);
export const snap = computed<ClockSnapshot | null>(() => {
  const g = game.value;
  return g ? snapshot(g.clock, now.value, g.settings.turnLimitMs) : null;
});

export function act(action: Action): void {
  if (history.value) history.value = dispatch(history.value, action);
}
export const undoAct = () => { if (history.value) history.value = undo(history.value); };
export const redoAct = () => { if (history.value) history.value = redo(history.value); };

export function startGame(players: PlayerSetup[], settings: GameSettings): void {
  history.value = initHistory(createGame(players, settings, Date.now()));
  screen.value = 'game';
}

/** Same players/settings, fresh counters. Clears undo history. */
export function resetGame(): void {
  const g = game.value;
  if (!g) return;
  act({
    type: 'newGame',
    players: g.players.map((p) => ({ name: p.name, color: p.color, hasPartner: p.hasPartner })),
    settings: g.settings,
    now: Date.now(),
  });
}

/** Hydrate from storage (integration hook). */
export function setHistory(h: History | null): void {
  history.value = h;
  screen.value = h ? 'game' : 'setup';
}

/** Subscribe-friendly: fn runs on every history change (and once initially). Returns disposer. */
export function onHistoryChange(fn: (h: History | null) => void): () => void {
  return effect(() => fn(history.value));
}

// 250ms tick only while the clock runs. Keyed on the boolean so taps (new history objects)
// don't recreate the interval; `now` only changes when the displayed second changes.
const clockRunning = computed(() => !!game.value?.clock.running);
effect(() => {
  if (!clockRunning.value) return;
  now.value = Date.now();
  const id = setInterval(() => {
    const t = Date.now();
    if (Math.floor(t / 1000) !== Math.floor(now.peek() / 1000)) now.value = t;
  }, 250);
  return () => clearInterval(id);
});

export const vibrate = (ms = 10) => {
  try { navigator.vibrate?.(ms); } catch { /* ignore */ }
};
