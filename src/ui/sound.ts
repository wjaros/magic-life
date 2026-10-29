// Turn-timer sound cues synthesized with Web Audio (no audio files).
// UI preference only: never part of GameState.
import { signal } from '@preact/signals';
import type { Cue } from '../timer/cues';

const KEY = 'magic-life/sound';

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export const soundEnabled = signal<boolean>(loadEnabled());

export function setSoundEnabled(on: boolean): void {
  soundEnabled.value = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch { /* ignore */ }
}

type Ctor = typeof AudioContext;
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
    const C = w.AudioContext ?? w.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Creates/resumes the shared AudioContext. Must run inside a user gesture on iOS/Safari. */
export function unlockAudio(): void {
  try {
    const c = getCtx();
    if (c && c.state === 'suspended') void c.resume()?.catch?.(() => {});
  } catch { /* ignore */ }
}

let unlockInstalled = false;
/** Unlocks audio on the first pointerdown/keydown anywhere. Idempotent. */
export function installAudioUnlock(): void {
  if (unlockInstalled || typeof window === 'undefined') return;
  unlockInstalled = true;
  const opts = { capture: true, passive: true } as const;
  const handler = () => {
    unlockAudio();
    // Keep listening until the context is really running (it may start suspended).
    if (ctx && ctx.state === 'running') {
      window.removeEventListener('pointerdown', handler, opts);
      window.removeEventListener('keydown', handler, opts);
    }
  };
  window.addEventListener('pointerdown', handler, opts);
  window.addEventListener('keydown', handler, opts);
}

interface Tone { freq: number; start: number; dur: number; peak: number; type?: OscillatorType; endFreq?: number }

const CUES: Record<Cue, Tone[]> = {
  minute: [{ freq: 880, start: 0, dur: 0.6, peak: 0.25, type: 'sine' }, { freq: 1760, start: 0, dur: 0.3, peak: 0.06, type: 'sine' }],
  tick: [{ freq: 660, start: 0, dur: 0.15, peak: 0.25, type: 'triangle' }],
  countdown: [{ freq: 1320, start: 0, dur: 0.12, peak: 0.28, type: 'triangle' }],
  timeout: [
    { freq: 880, start: 0, dur: 0.3, peak: 0.3, type: 'triangle' },
    { freq: 440, start: 0.3, dur: 0.6, peak: 0.3, type: 'triangle' },
  ],
};

export function playCue(cue: Cue): void {
  if (!soundEnabled.value) return;
  try {
    const c = getCtx();
    if (!c) return;
    if (c.state === 'suspended') void c.resume()?.catch?.(() => {});
    const t0 = c.currentTime;
    for (const t of CUES[cue]) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = t.type ?? 'sine';
      osc.frequency.value = t.freq;
      const a = t0 + t.start;
      gain.gain.setValueAtTime(0.0001, a);
      gain.gain.linearRampToValueAtTime(t.peak, a + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, a + t.dur);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(a);
      osc.stop(a + t.dur + 0.05);
    }
  } catch { /* audio is best-effort */ }
}
