import { render } from 'preact';
import { initPwa } from './pwa';
import { loadLastSeen, markSeen, pauseIfStale, saveSoon, storage } from './storage';
import { App } from './ui/App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { onHistoryChange, setHistory } from './ui/store';
import './ui/styles.css';

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

render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
  document.getElementById('app')!,
);
