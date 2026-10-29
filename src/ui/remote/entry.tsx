import { render } from 'preact';
import { initPwa } from '../../pwa';
import { RemoteApp } from './RemoteApp';
import './remote.css';

/** Remote (phone) app: no host game hydration or persistence; wake lock stays on. */
export function mountRemote(root: HTMLElement): void {
  initPwa();
  render(<RemoteApp />, root);
}
