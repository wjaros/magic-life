import { registerSW } from './register';
import { enableWakeLock } from './wakeLock';

export { registerSW } from './register';
export { enableWakeLock } from './wakeLock';

/**
 * One-time PWA startup: registers the service worker and enables the screen wake lock.
 * @returns a disposer that tears the wake lock down (service worker stays registered).
 */
export function initPwa(): () => void {
  registerSW();
  return enableWakeLock();
}
