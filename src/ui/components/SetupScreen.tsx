import { useState } from 'preact/hooks';
import { MAX_PINNED } from '../../core/types';
import type { BuiltinCounter } from '../../core/types';
import { game, screen, startGame } from '../store';
import { BUILTIN_META, BUILTIN_ORDER, isBuiltinKey } from './counters';
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

  const [pins, setPins] = useState<BuiltinCounter[][]>(() =>
    prefill((i) => cur?.players[i]?.pinned.filter(isBuiltinKey), () => []),
  );
  // Only pinned custom counters are carried over: they are what the setup row can show.
  const [customs, setCustoms] = useState<string[][]>(() =>
    prefill(
      (i) => {
        const pl = cur?.players[i];
        return pl?.pinned
          .map((k) => pl.customCounters.find((c) => c.id === k)?.name)
          .filter((n): n is string => n !== undefined);
      },
      () => [],
    ),
  );
  const [drafts, setDrafts] = useState<string[]>(() => prefill(() => undefined, () => ''));

  const set = <T,>(arr: T[], i: number, v: T) => arr.map((x, j) => (j === i ? v : x));
  const pickColor = (i: number, c: string) => {
    const j = colors.findIndex((x, k) => x === c && k < count && k !== i);
    // swap with whoever has it so colors stay distinct
    setColors(colors.map((x, k) => (k === i ? c : k === j ? colors[i] : x)));
  };

  const addCustom = (i: number) => {
    const n = drafts[i].trim();
    if (!n || pins[i].length + customs[i].length >= MAX_PINNED) return;
    setCustoms(set(customs, i, [...customs[i], n]));
    setDrafts(set(drafts, i, ''));
  };

  const start = () => {
    startGame(
      Array.from({ length: count }, (_, i) => ({
        name: names[i].trim() || `Gracz ${i + 1}`,
        color: colors[i],
        hasPartner: partners[i],
        pinned: pins[i],
        customCounters: customs[i],
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
            <div class="pinsetup">
              <div class="pinsetup-title">
                Liczniki na panelu
                {pins[i].length + customs[i].length >= MAX_PINNED && <span class="hint"> (maks. {MAX_PINNED})</span>}
              </div>
              <div class="chips small">
                {BUILTIN_ORDER.map((k) => {
                  const on = pins[i].includes(k);
                  const full = pins[i].length + customs[i].length >= MAX_PINNED;
                  return (
                    <button
                      key={k}
                      class={`chip${on ? ' on' : ''}`}
                      aria-pressed={on}
                      disabled={!on && full}
                      title={!on && full ? 'maks. 2' : undefined}
                      onClick={() => setPins(set(pins, i, on ? pins[i].filter((x) => x !== k) : [...pins[i], k]))}
                    >
                      {k === 'tax' ? 'Tax' : `${BUILTIN_META[k].label} ${BUILTIN_META[k].short}`}
                    </button>
                  );
                })}
                {customs[i].map((n, j) => (
                  <button
                    key={`${j}-${n}`}
                    class="chip on custom"
                    aria-label={`Usuń licznik ${n}`}
                    onClick={() => setCustoms(set(customs, i, customs[i].filter((_, k) => k !== j)))}
                  >
                    <span class="chip-text">{n}</span> ✕
                  </button>
                ))}
              </div>
              <div class="addc">
                <input
                  class="cname-input"
                  value={drafts[i]}
                  maxLength={24}
                  placeholder="Własny licznik, np. Skarby"
                  aria-label={`Własny licznik gracza ${i + 1}`}
                  onInput={(e) => setDrafts(set(drafts, i, (e.currentTarget as HTMLInputElement).value))}
                  onKeyDown={(e) => { if (e.key === 'Enter') addCustom(i); }}
                />
                <button
                  class="btn"
                  aria-label={`Dodaj licznik gracza ${i + 1}`}
                  disabled={!drafts[i].trim() || pins[i].length + customs[i].length >= MAX_PINNED}
                  onClick={() => addCustom(i)}
                >
                  Dodaj
                </button>
              </div>
            </div>
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
