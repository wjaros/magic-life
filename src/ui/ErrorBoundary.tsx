import { Component, type ComponentChildren } from 'preact';
import { storage } from '../storage';
import { setHistory } from './store';

interface State { failed: boolean }

/** Last resort: a render crash (e.g. corrupt state) clears storage and falls back to setup. */
export class ErrorBoundary extends Component<{ children?: ComponentChildren }, State> {
  state: State = { failed: false };

  componentDidCatch(): void {
    try { storage.clear(); } catch { /* ignore */ }
    setHistory(null);
    this.setState({ failed: true });
  }

  render() {
    if (this.state.failed) {
      return (
        <div class="crash" role="alert">
          <p>Coś poszło nie tak. Zapisana gra została usunięta.</p>
          <button class="btn primary" onClick={() => this.setState({ failed: false })}>
            Nowa gra
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
