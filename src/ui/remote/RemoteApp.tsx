import { useEffect } from 'preact/hooks';
import { isRoomCode } from '../../net/protocol';
import { loadStoredRemote, remote, storedName } from '../../net/remote';
import { JoinScreen } from './JoinScreen';
import { RemoteScreen } from './RemoteScreen';
import { SeatPicker } from './SeatPicker';
import { Banner, Toast, exitRoom } from './parts';

/** Reads ?join=CODE&seat=ID; a stored seat for the same room wins over the URL (latest choice). */
export function startFromUrl(search = location.search): boolean {
  const q = new URLSearchParams(search);
  const stored = loadStoredRemote();
  let code = (q.get('join') ?? '').trim().toUpperCase();
  // Bare /?join (code typed by hand earlier): resume the stored room, if any.
  if (!isRoomCode(code) && stored && isRoomCode(stored.room)) code = stored.room;
  if (!isRoomCode(code)) return false;
  const sameRoom = stored?.room === code;
  const seat = sameRoom ? stored!.seat : q.get('seat');
  remote.start(code, seat, sameRoom ? stored!.name : storedName());
  return true;
}

export function RemoteApp() {
  useEffect(() => {
    // Start once from the URL; the code input on JoinScreen calls remote.start itself.
    if (!remote.room.value) startFromUrl();
  }, []);

  const room = remote.room.value;
  const g = remote.game.value;
  const mySeat = remote.mySeat.value;
  const desired = remote.desiredSeat.value;

  let body;
  if (!room || remote.error.value === 'no-room') body = <JoinScreen />;
  else if (mySeat && g) body = <RemoteScreen />;
  else if (!g) body = <Connecting />;
  else if (desired) body = <Connecting claiming />;
  else body = <SeatPicker />;

  return (
    <main class="app remote" onContextMenu={(e) => e.preventDefault()}>
      {room && <Banner />}
      {body}
      <Toast />
    </main>
  );
}

function Connecting(props: { claiming?: boolean }) {
  return (
    <div class="r-center">
      <div class="r-spinner" aria-hidden="true" />
      <p>{props.claiming ? 'Zajmuję miejsce…' : 'Łączenie…'}</p>
      {props.claiming && (
        <button class="btn" onClick={() => remote.release()}>Wybierz innego gracza</button>
      )}
      {!props.claiming && remote.hostOnline.value !== false && remote.status.value === 'open' && (
        <p class="r-sub">Czekam na stan gry od hosta</p>
      )}
      <button class="btn" onClick={() => exitRoom()}>Wyjdź</button>
    </div>
  );
}
