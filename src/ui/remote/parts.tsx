import { useEffect } from 'preact/hooks';
import { remote } from '../../net/remote';

export const REFUSED_LABEL: Record<string, string> = {
  'seat-taken': 'To miejsce jest już zajęte',
  'not-your-player': 'Możesz zmieniać tylko swojego gracza',
  'not-allowed': 'Host nie zezwolił na tę akcję',
};

/** Leave the room and drop ?join from the URL so a reload doesn't rejoin. */
export function exitRoom(): void {
  remote.leave();
  try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
}

export const vibrate = (ms = 10) => {
  try { navigator.vibrate?.(ms); } catch { /* ignore */ }
};

/** Connection / host status strip. */
export function Banner() {
  const status = remote.status.value;
  const err = remote.error.value;
  let text: string | null = null;
  if (err === 'no-room') return null; // JoinScreen explains it
  if (status !== 'open') text = 'Łączenie…';
  else if (remote.hostOnline.value === false) text = 'Host offline — czekam';
  if (!text) return null;
  return <div class="r-banner" role="status">{text}</div>;
}

export function Toast() {
  const reason = remote.lastRefused.value;
  useEffect(() => {
    if (!reason) return;
    const id = setTimeout(() => remote.clearRefused(), 3500);
    return () => clearTimeout(id);
  }, [reason]);
  if (!reason) return null;
  return <div class="r-toast" role="alert">{REFUSED_LABEL[reason] ?? 'Odmowa hosta'}</div>;
}
