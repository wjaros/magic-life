import { useEffect, useRef, useState } from 'preact/hooks';
import type { Action, GameState, PinKey, Player } from '../../core/types';
import { remote } from '../../net/remote';
import { formatMs, lossReason, snapshot } from '../engine';
import { isBuiltinKey, resolvePinned } from '../components/counters';
import { REASON_LABEL } from '../components/layout';
import { useHold } from '../useHold';
import { setSoundEnabled, soundEnabled } from '../sound';
import { RemoteSheet } from './RemoteSheet';
import { exitRoom, vibrate } from './parts';

const BADGE_MS = 2000;

function pinAction(p: Player, key: PinKey, delta: number): Action {
  if (!isBuiltinKey(key)) return { type: 'adjustCustomCounter', playerId: p.id, counterId: key, delta };
  switch (key) {
    case 'energy': return { type: 'adjustEnergy', playerId: p.id, delta };
    case 'experience': return { type: 'adjustExperience', playerId: p.id, delta };
    case 'poison': return { type: 'adjustPoison', playerId: p.id, delta };
    case 'tax': return { type: 'adjustCommanderCasts', playerId: p.id, slot: 0, delta };
  }
}

const stop = (e: Event) => e.stopPropagation();

function Pin(props: { player: Player; pinKey: PinKey }) {
  const p = props.player;
  const info = resolvePinned(p, props.pinKey);
  const step = (n: number) => { remote.act(pinAction(p, props.pinKey, n)); vibrate(10); };
  const minus = useHold(step, -1, { holdStep: 1, repeatMs: 250 });
  const plus = useHold(step, 1, { holdStep: 1, repeatMs: 250 });
  if (!info) return null;
  const guard = (h: ReturnType<typeof useHold>) => ({
    ...h,
    onPointerDown(e: PointerEvent) { e.stopPropagation(); h.onPointerDown(e); },
    onClick(e: MouseEvent) { e.stopPropagation(); h.onClick(e); },
  });
  return (
    <div class="r-pin" onPointerDown={stop} onClick={stop}>
      <button class="r-pin-btn" {...guard(minus)} aria-label={`${info.label} minus`}>−</button>
      <div class="r-pin-mid" aria-live="polite">
        <span class="r-pin-label">{info.short}</span>
        <span class="r-pin-val">{info.display}</span>
      </div>
      <button class="r-pin-btn" {...guard(plus)} aria-label={`${info.label} plus`}>+</button>
    </div>
  );
}

/** Seconds tick for clock display. */
function useTick(): number {
  const [t, setT] = useState(() => remote.hostTime());
  useEffect(() => {
    const id = setInterval(() => setT(remote.hostTime()), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

export function RemoteScreen() {
  const g = remote.game.value as GameState;
  const seat = remote.mySeat.value!;
  const p = g.players.find((x) => x.id === seat);
  const [sheet, setSheet] = useState(false);
  const [menu, setMenu] = useState(false);
  useTick();
  if (!p) return null;
  const s = snapshot(g.clock, remote.hostTime(), g.settings.turnLimitMs);
  return (
    <div class="r-screen" style={{ '--pc': p.color }}>
      <Header g={g} p={p} turnMs={s.turnMs} running={s.running} onMenu={() => setMenu(true)} />
      <Tile g={g} p={p} playerMs={s.playerMs[p.id] ?? 0} onSheet={() => setSheet(true)} />
      <BottomBar g={g} p={p} onSheet={() => setSheet(true)} />
      {sheet && <RemoteSheet playerId={p.id} onClose={() => setSheet(false)} />}
      {menu && <Menu onClose={() => setMenu(false)} />}
    </div>
  );
}

function Header(props: { g: GameState; p: Player; turnMs: number; running: boolean; onMenu: () => void }) {
  const { g, p } = props;
  const activeId = g.clock.activePlayerId;
  const mine = activeId === p.id;
  const active = g.players.find((x) => x.id === activeId);
  const over = mine && g.settings.turnLimitMs != null && props.turnMs > g.settings.turnLimitMs;
  return (
    <header class={`r-head${mine ? ' mine' : ''}${over ? ' over' : ''}`}>
      <div class="r-head-main">
        <b class="r-name">{p.name}</b>
        <span class="r-turn" aria-live="polite">
          {active
            ? mine ? `Twoja tura ${formatMs(props.turnMs)}` : `Tura ${g.clock.turn}: ${active.name} ${formatMs(props.turnMs)}`
            : `Tura ${g.clock.turn}`}
        </span>
      </div>
      <button
        class="r-pill" aria-label={props.running ? 'Zatrzymaj zegar' : 'Uruchom zegar'}
        onClick={() => remote.act({ type: props.running ? 'clockPause' : 'clockStart', now: Date.now() })}
      >{props.running ? '⏸ Pauza' : '▶ Start'}</button>
      <button class="r-pill" aria-label="Menu" onClick={props.onMenu}>⋯</button>
    </header>
  );
}

function Tile(props: { g: GameState; p: Player; playerMs: number; onSheet: () => void }) {
  const { g, p } = props;
  const reason = lossReason(p);
  const [delta, setDelta] = useState(0);
  const [pending, setPending] = useState(0);
  const prev = useRef(p.life);
  const prevGame = useRef(g.createdAt);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    setPending(0);
    if (prevGame.current !== g.createdAt) {
      prevGame.current = g.createdAt;
      prev.current = p.life;
      setDelta(0);
      return;
    }
    if (p.life !== prev.current) {
      setDelta((d) => d + (p.life - prev.current));
      prev.current = p.life;
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setDelta(0), BADGE_MS);
    }
  }, [p.life, g.createdAt]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Show taps immediately until the host's state catches up; clear if it never does.
  const pendTimer = useRef<number | undefined>(undefined);
  const adjust = (n: number) => {
    remote.act({ type: 'adjustLife', playerId: p.id, delta: n });
    vibrate(10);
    setPending((x) => x + n);
    clearTimeout(pendTimer.current);
    pendTimer.current = window.setTimeout(() => setPending(0), 3000);
  };
  useEffect(() => () => clearTimeout(pendTimer.current), []);
  const minus = useHold(adjust, -1);
  const plus = useHold(adjust, 1);
  const shown = delta + pending;
  const tax = p.commanderCasts[0] * 2;
  const tax2 = p.commanderCasts[1] * 2;

  return (
    <section class={`r-tile${reason ? ' out' : ''}`}>
      <div class="r-zone r-zone-minus" role="button" tabIndex={0} aria-label="Życie −1" {...minus}>
        <span class="r-zone-hint">−</span>
      </div>
      <div class="r-zone r-zone-plus" role="button" tabIndex={0} aria-label="Życie +1" {...plus}>
        <span class="r-zone-hint">+</span>
      </div>
      <div class="r-life-wrap">
        <div class="r-life" aria-live="polite" data-testid="life">{p.life}</div>
        {shown !== 0 && (
          <div class={`r-delta ${shown > 0 ? 'pos' : 'neg'}`}>{shown > 0 ? `+${shown}` : `−${-shown}`}</div>
        )}
      </div>
      {p.pinned.length > 0 && (
        <div class="r-pins" onPointerDown={stop} onClick={stop}>
          {p.pinned.map((k) => <Pin key={k} player={p} pinKey={k} />)}
        </div>
      )}
      <button class="r-stats" onClick={props.onSheet} aria-label="Liczniki — podgląd">
        <span>☠ {p.poison}</span>
        <span>Tax {tax}{p.hasPartner ? `/${tax2}` : ''}</span>
        {g.monarch === p.id && <span>👑</span>}
        {g.initiative === p.id && <span>🏰</span>}
        <span>⏱ {formatMs(props.playerMs)}</span>
      </button>
      {reason && (
        <div class="r-out" role="status">
          <div class="r-out-title">Odpadasz</div>
          <div class="r-out-reason">{REASON_LABEL[reason]}</div>
          {reason === 'conceded' && (
            <button class="btn" onClick={() => remote.act({ type: 'setConceded', playerId: p.id, conceded: false })}>
              Wróć do gry
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function BottomBar(props: { g: GameState; p: Player; onSheet: () => void }) {
  const { g, p } = props;
  const mine = g.clock.activePlayerId === p.id;
  return (
    <footer class="r-bottom">
      {mine && (
        <button
          class="btn primary r-end"
          onClick={() => { remote.act({ type: 'clockNextTurn', now: Date.now() }); vibrate(30); }}
        >Zakończ turę</button>
      )}
      <div class="r-bottom-row">
        <button class="btn" onClick={() => remote.undo()}>Cofnij</button>
        <button class="btn r-grow" onClick={props.onSheet}>Liczniki</button>
      </div>
    </footer>
  );
}

function Menu(props: { onClose: () => void }) {
  return (
    <div class="r-overlay" onClick={props.onClose}>
      <div class="r-menu" onClick={stop} role="dialog" aria-label="Menu">
        <button class="btn" role="switch" aria-checked={soundEnabled.value} onClick={() => setSoundEnabled(!soundEnabled.value)}>
          🔔 Dźwięk: {soundEnabled.value ? 'wł.' : 'wył.'}
        </button>
        <button class="btn" onClick={() => { props.onClose(); remote.release(); }}>Zmień gracza</button>
        <button class="btn danger" onClick={() => { props.onClose(); exitRoom(); }}>Wyjdź</button>
        <button class="btn" onClick={props.onClose}>Zamknij</button>
      </div>
    </div>
  );
}
