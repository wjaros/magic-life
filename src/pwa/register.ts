/// <reference types="vite-plugin-pwa/client" />
import { registerSW as registerServiceWorker } from 'virtual:pwa-register';

/**
 * Registers the service worker (precache + offline). With registerType 'autoUpdate'
 * new versions are installed and activated automatically; no prompt is shown.
 * Safe to call in any environment: registration errors are logged, never thrown.
 */
export function registerSW(): void {
  try {
    registerServiceWorker({
      immediate: true,
      onRegisterError(error: unknown) {
        console.warn('Service worker registration failed', error);
      },
    });
  } catch (error) {
    console.warn('Service worker registration failed', error);
  }
}
