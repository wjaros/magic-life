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

/**
 * Creates/resumes the shared AudioContext. Must run inside a user gesture on iOS/Safari,
 * which only counts the END of a touch (touchend/click), not pointerdown/touchstart.
 */
export function unlockAudio(): void {
  try {
    // iOS 17+: use the playback session so the hardware silent switch does not mute cues.
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession && nav.audioSession.type !== 'playback') nav.audioSession.type = 'playback';
    const c = getCtx();
    if (!c) return;
    if (c.state !== 'running') void c.resume()?.catch?.(() => {});
    // Older iOS only really unlocks after something is played inside the gesture.
    const buf = c.createBuffer(1, 1, 22050);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(0);
  } catch { /* ignore */ }
}

const UNLOCK_EVENTS = ['pointerup', 'touchend', 'click', 'keydown'] as const;

let unlockInstalled = false;
/** Unlocks audio on user gestures until the context is running. Idempotent. */
export function installAudioUnlock(): void {
  if (unlockInstalled || typeof window === 'undefined') return;
  unlockInstalled = true;
  const opts = { capture: true, passive: true } as const;
  const handler = () => {
    unlockAudio();
    // Keep listening until the context is really running (resume() is async).
    if (ctx && ctx.state === 'running') {
      for (const e of UNLOCK_EVENTS) window.removeEventListener(e, handler, opts);
    }
  };
  for (const e of UNLOCK_EVENTS) window.addEventListener(e, handler, opts);
  // iOS suspends the context when the app goes to the background; listen again on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ctx && ctx.state !== 'running') {
      for (const e of UNLOCK_EVENTS) window.addEventListener(e, handler, opts);
    }
  });
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

/** Plays the minute cue immediately, from a button tap (also unlocks audio). Ignores the toggle. */
export function testSound(): void {
  unlockAudio();
  const was = soundEnabled.value;
  soundEnabled.value = true;
  playCue('minute');
  soundEnabled.value = was;
}
