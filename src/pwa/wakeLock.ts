/**
 * Keeps the screen on while the game is visible.
 *
 * 1. Screen Wake Lock API. The browser releases the lock whenever the page is hidden, so it
 *    is requested again on `visibilitychange` back to 'visible' and on user gestures (Safari
 *    may refuse a request made without one).
 * 2. Fallback where the API is missing or refused, and always on iOS (missing before Safari
 *    16.4, silently ineffective in home-screen apps before iOS 18.4): a tiny muted, looping,
 *    inline video. iOS keeps the screen on while a video plays (the NoSleep.js technique).
 *
 * @returns a disposer that releases the lock and removes the listeners.
 */
export function enableWakeLock(): () => void {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return () => {};

  const hasApi = 'wakeLock' in navigator;
  // On iOS home-screen apps before 18.4 the request "succeeds" but the screen still dims,
  // so on iOS the video always runs alongside the API.
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let sentinel: WakeLockSentinel | null = null;
  let disposed = false;
  let inflight: Promise<void> | null = null;
  let video: HTMLVideoElement | null = null;

  const held = () => sentinel !== null && !sentinel.released;

  const acquire = (): Promise<void> => {
    if (!hasApi) return Promise.resolve();
    if (inflight) return inflight; // concurrent callers share one request
    if (disposed || document.visibilityState !== 'visible') return Promise.resolve();
    if (held()) return Promise.resolve();
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
        // Denied (no user gesture yet, battery saver, policy) or broken: the video fallback covers it.
        sentinel = null;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };

  const playVideo = (): void => {
    if (disposed) return;
    if (!video) {
      video = document.createElement('video');
      video.src = `${import.meta.env.BASE_URL}nosleep.mp4`;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('muted', '');
      video.setAttribute('aria-hidden', 'true');
      video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0';
      document.body.appendChild(video);
    }
    if (video.paused) void video.play().catch(() => {});
  };

  // Must run inside a user gesture: both the API request (Safari) and video.play() need one.
  const onGesture = (): void => {
    if (disposed) return;
    if (isIOS || !hasApi) playVideo();
    void acquire().then(() => {
      if (!held()) playVideo(); // muted inline video may start outside a gesture
    });
  };

  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      void acquire();
      if (video && video.paused && (isIOS || !held())) void video.play().catch(() => {});
    }
  };

  const opts = { capture: true, passive: true } as const;
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('click', onGesture, opts);
  window.addEventListener('touchend', onGesture, opts);
  void acquire();

  return () => {
    disposed = true;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('click', onGesture, opts);
    window.removeEventListener('touchend', onGesture, opts);
    const current = sentinel;
    sentinel = null;
    if (current !== null && !current.released) current.release().catch(() => {});
    video?.pause();
    video?.remove();
    video = null;
  };
}
