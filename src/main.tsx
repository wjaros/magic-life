import { render } from 'preact';
import { host } from './net/host';
import { initPwa } from './pwa';
import { loadLastSeen, markSeen, pauseIfStale, saveSoon, storage } from './storage';
import { App } from './ui/App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { startHostSound } from './ui/soundWiring';
import { onHistoryChange, setHistory } from './ui/store';
import './ui/styles.css';

function mountHost() {
  try {
    const loaded = storage.load();
    setHistory(loaded ? pauseIfStale(loaded, loadLastSeen(), Date.now()) : null);
  } catch {
    storage.clear();
    setHistory(null);
  }
  markSeen();
  onHistoryChange((h) => (h ? saveSoon(h) : storage.clear()));
  initPwa();
  startHostSound();
  void host.discoverRelay();

  render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
    document.getElementById('app')!,
  );
}

// ?join in the URL = this device is a remote (phone) for someone else's game: never touch the host save.
if (new URLSearchParams(location.search).has('join')) {
  import('./ui/remote/entry').then((m) => m.mountRemote(document.getElementById('app')!));
} else {
  mountHost();
}
