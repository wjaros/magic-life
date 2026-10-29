import { useState } from 'preact/hooks';
import { game, screen, startGame } from '../store';
import { PALETTE } from './layout';

const LIVES = [20, 30, 40];
const LIMITS: Array<[string, number | null]> = [['Wył.', null], ['1 min', 1], ['2 min', 2], ['3 min', 3], ['5 min', 5]];

/** Existing game (when opened via "Nowa gra") prefills names, colors, partners and settings. */
function prefill<T>(fromGame: (i: number) => T | undefined, fallback: (i: number) => T): T[] {
  return Array.from({ length: 6 }, (_, i) => fromGame(i) ?? fallback(i));
}

export function SetupScreen() {
  const cur = game.peek();
  const [count, setCount] = useState(() => cur ? Math.min(6, Math.max(2, cur.players.length)) : 4);
  const [life, setLife] = useState(() => cur?.settings.startingLife ?? 40);
  const [limit, setLimit] = useState<number | null>(() =>
    cur?.settings.turnLimitMs != null ? cur.settings.turnLimitMs / 60_000 : null,
  );
  const [names, setNames] = useState<string[]>(() =>
    prefill((i) => cur?.players[i]?.name, (i) => `Gracz ${i + 1}`),
  );
  const [colors, setColors] = useState<string[]>(() =>
    prefill((i) => cur?.players[i]?.color, (i) => PALETTE[i]),
  );
  const [partners, setPartners] = useState<boolean[]>(() =>
    prefill((i) => cur?.players[i]?.hasPartner, () => false),
  );

  const set = <T,>(arr: T[], i: number, v: T) => arr.map((x, j) => (j === i ? v : x));
  const pickColor = (i: number, c: string) => {
    const j = colors.findIndex((x, k) => x === c && k < count && k !== i);
    // swap with whoever has it so colors stay distinct
    setColors(colors.map((x, k) => (k === i ? c : k === j ? colors[i] : x)));
  };

  const start = () => {
    startGame(
      Array.from({ length: count }, (_, i) => ({
        name: names[i].trim() || `Gracz ${i + 1}`,
        color: colors[i],
        hasPartner: partners[i],
      })),
      { startingLife: life, turnLimitMs: limit == null ? null : limit * 60_000 },
    );
  };

  return (
    <div class="setup">
      <h1>Magic Life</h1>

      <h2>Liczba graczy</h2>
      <div class="chips">
        {[2, 3, 4, 5, 6].map((n) => (
          <button key={n} class={`chip${count === n ? ' on' : ''}`} onClick={() => setCount(n)}>{n}</button>
        ))}
      </div>

      <h2>Życie startowe</h2>
      <div class="chips">
        {LIVES.map((l) => (
          <button key={l} class={`chip${life === l ? ' on' : ''}`} onClick={() => setLife(l)}>{l}</button>
        ))}
      </div>

      <h2>Limit czasu tury</h2>
      <div class="chips">
        {LIMITS.map(([label, v]) => (
          <button key={label} class={`chip${limit === v ? ' on' : ''}`} onClick={() => setLimit(v)}>{label}</button>
        ))}
      </div>

      <h2>Gracze</h2>
      <div class="plist">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} class="prow" style={{ '--pc': colors[i] }}>
            <input
              class="pname"
              value={names[i]}
              maxLength={20}
              aria-label={`Nazwa gracza ${i + 1}`}
              onInput={(e) => setNames(set(names, i, (e.currentTarget as HTMLInputElement).value))}
            />
            <label class="partner">
              <input
                type="checkbox"
                checked={partners[i]}
                onChange={(e) => setPartners(set(partners, i, (e.currentTarget as HTMLInputElement).checked))}
              />
              Partner
            </label>
            <div class="swatches">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  class={`swatch${colors[i] === c ? ' on' : ''}`}
                  style={{ background: c }}
                  aria-label={`Kolor ${c}`}
                  onClick={() => pickColor(i, c)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <button class="btn primary start" onClick={start}>Start</button>
      {cur && (
        <button class="btn back" onClick={() => { screen.value = 'game'; }}>Wróć do gry</button>
      )}
    </div>
  );
}
