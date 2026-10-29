/**
 * Keeps the screen on while the game is visible (Screen Wake Lock API).
 *
 * The browser releases the lock whenever the page is hidden, so it is requested
 * again on every `visibilitychange` back to 'visible'. Where the API is missing
 * (e.g. iOS < 16.4) or the request is refused, this silently does nothing.
 *
 * @returns a disposer that releases the lock and removes the listener.
 */
export function enableWakeLock(): () => void {
  if (typeof navigator === 'undefined' || typeof document === 'undefined' || !('wakeLock' in navigator)) {
    return () => {};
  }

  let sentinel: WakeLockSentinel | null = null;
  let disposed = false;
  let inflight: Promise<void> | null = null;

  const acquire = (): Promise<void> => {
    if (inflight) return inflight; // concurrent callers share one request
    if (disposed || document.visibilityState !== 'visible') return Promise.resolve();
    if (sentinel !== null && !sentinel.released) return Promise.resolve();
    inflight = (async () => {
      try {
        const s = await navigator.wakeLock.request('screen');
        if (disposed) {
          s.release().catch(() => {});
          return;
        }
        sentinel = s;
        // The system may release the lock (battery saver, ...): take it again if we can.
        s.addEventListener('release', () => {
          if (sentinel === s) sentinel = null;
          if (!disposed && document.visibilityState === 'visible') void acquire();
        });
      } catch {
        // Denied (battery saver, policy, not visible yet) or unsupported: not an error for the game.
        sentinel = null;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };

  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') void acquire();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  void acquire();

  return () => {
    disposed = true;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    const current = sentinel;
    sentinel = null;
    if (current !== null && !current.released) {
      current.release().catch(() => {});
    }
  };
}
