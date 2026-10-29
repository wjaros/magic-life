import { useState } from 'preact/hooks';
import { ROOM_ALPHABET, ROOM_CODE_LENGTH, isRoomCode } from '../../net/protocol';
import { remote, saveName, storedName } from '../../net/remote';

const clean = (s: string) =>
  [...s.toUpperCase()].filter((c) => ROOM_ALPHABET.includes(c)).join('').slice(0, ROOM_CODE_LENGTH);

/** Code + optional name entry. Shown at /?join (no/invalid code) or after "Brak pokoju" / "Wyjdź". */
export function JoinScreen() {
  const [code, setCode] = useState(() => {
    const raw = new URLSearchParams(location.search).get('join') ?? '';
    return clean(raw);
  });
  const [name, setName] = useState(storedName);
  const err = remote.error.value;
  const ok = isRoomCode(code);
  const go = (e: Event) => {
    e.preventDefault();
    if (!ok) return;
    saveName(name.trim());
    remote.start(code, null, name);
    try { history.replaceState(null, '', `?join=${code}`); } catch { /* ignore */ }
  };
  return (
    <form class="r-join" onSubmit={go}>
      <h1>Dołącz do gry</h1>
      <p class="r-sub">Wpisz kod z ekranu gospodarza albo zeskanuj jego kod QR.</p>
      {err === 'no-room' && <p class="r-error" role="alert">Brak pokoju o takim kodzie. Sprawdź kod.</p>}
      <label class="r-field">
        <span>Kod pokoju</span>
        <input
          class="r-code" value={code} inputMode="text" autoCapitalize="characters" autoComplete="off"
          autoCorrect="off" spellcheck={false} maxLength={ROOM_CODE_LENGTH} placeholder="XXXXX"
          aria-label="Kod pokoju"
          onInput={(e) => setCode(clean((e.currentTarget as HTMLInputElement).value))}
        />
      </label>
      <label class="r-field">
        <span>Twoje imię (opcjonalnie)</span>
        <input
          class="pname" value={name} maxLength={32} placeholder="np. Ola" aria-label="Twoje imię"
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <button class="btn primary r-big" type="submit" disabled={!ok}>Dołącz</button>
    </form>
  );
}
