import { useEffect, useRef } from 'preact/hooks';

const LONG_PRESS_MS = 500;

interface HoldOptions {
  /** Step applied on every repeat while held (a tap is always ±1). */
  holdStep?: number;
  repeatMs?: number;
}

/**
 * Tap = ±1, hold = repeating ±holdStep. Tracks a single pointer: events from any other
 * pointer on the same element are ignored, so a second finger never cancels the first's timer.
 */
export function useHold(onStep: (n: number) => void, dir: 1 | -1, opts: HoldOptions = {}) {
  const { holdStep = 10, repeatMs = 400 } = opts;
  const t = useRef<{
    pointerId: number | null;
    timeout?: number;
    interval?: number;
    fired: boolean;
  }>({ pointerId: null, fired: false });
  const stepRef = useRef(onStep);
  stepRef.current = onStep;
  const clear = () => {
    clearTimeout(t.current.timeout);
    clearInterval(t.current.interval);
    t.current.timeout = undefined;
    t.current.interval = undefined;
  };
  useEffect(() => clear, []);

  const end = (e: PointerEvent, commit: boolean) => {
    if (t.current.pointerId !== e.pointerId) return;
    const fired = t.current.fired;
    clear();
    t.current.pointerId = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    if (commit && !fired) stepRef.current(dir);
  };

  return {
    onPointerDown(e: PointerEvent) {
      e.preventDefault();
      if (t.current.pointerId !== null) return; // another pointer already owns this zone
      t.current.pointerId = e.pointerId;
      t.current.fired = false;
      try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
      t.current.timeout = window.setTimeout(() => {
        t.current.fired = true;
        stepRef.current(holdStep * dir);
        t.current.interval = window.setInterval(() => stepRef.current(holdStep * dir), repeatMs);
      }, LONG_PRESS_MS);
    },
    onPointerUp(e: PointerEvent) { end(e, true); },
    onPointerCancel(e: PointerEvent) { end(e, false); },
    onContextMenu(e: Event) { e.preventDefault(); },
    /** For role="button" non-button elements. */
    onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        stepRef.current(dir);
      }
    },
    /** For real <button>s: only keyboard-generated clicks (detail 0); pointer input is handled above. */
    onClick(e: MouseEvent) {
      if (e.detail === 0) stepRef.current(dir);
    },
  };
}
