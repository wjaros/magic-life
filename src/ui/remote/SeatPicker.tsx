import { remote } from '../../net/remote';
import { lossReason } from '../engine';
import { exitRoom } from './parts';

/** Choose which player's tile this phone controls. */
export function SeatPicker() {
  const g = remote.game.value!;
  const seats = remote.seats.value;
  return (
    <div class="r-pick">
      <h1>Wybierz gracza</h1>
      <p class="r-sub">Pokój {remote.room.value}</p>
      <ul class="r-seats">
        {g.players.map((p) => {
          const holder = seats[p.id];
          const taken = !!holder && holder !== remote.myClientId;
          return (
            <li key={p.id}>
              <button
                class="r-seat" style={{ '--pc': p.color }} disabled={taken}
                aria-label={`${p.name}${taken ? ' (zajęte)' : ''}`}
                onClick={() => remote.claim(p.id)}
              >
                <i class="r-dot" />
                <span class="r-seat-name">{p.name}</span>
                <span class="r-seat-life">{p.life}</span>
                {taken ? <span class="r-seat-tag">zajęte</span> : lossReason(p) ? <span class="r-seat-tag">odpadł</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      <button class="btn" onClick={() => exitRoom()}>Wyjdź</button>
    </div>
  );
}
