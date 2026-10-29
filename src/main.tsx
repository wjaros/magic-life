import { render } from 'preact';
import { initPwa } from './pwa';
import { saveSoon, storage } from './storage';
import { App } from './ui/App';
import { onHistoryChange, setHistory } from './ui/store';
import './ui/styles.css';

setHistory(storage.load());
onHistoryChange((h) => (h ? saveSoon(h) : storage.clear()));
initPwa();

render(<App />, document.getElementById('app')!);
