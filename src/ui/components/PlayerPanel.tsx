import { useEffect, useRef, useState } from 'preact/hooks';
import type { Player } from '../../core/types';
import { formatMs, lossReason } from '../engine';
import { act, game, snap, vibrate } from '../store';
import { Rotated } from './Rotated';
import { REASON_LABEL } from './layout';

const LONG_PRESS_MS = 500;
const REPEAT_MS = 400;
const BADGE_MS = 2000;

/** Tap = ±1, hold = ±10 repeating. */
function useHold(onStep: (n: number) => void, dir: 1 | -1) {
  const t = useRef<{ timeout?: number; interval?: number; fired: boolean }>({ fired: false });
  const stepRef = useRef(onStep);
  stepRef.current = onStep;
  const clear = () => {
    clearTimeout(t.current.timeout);
    clearInterval(t.current.interval);
  };
  useEffect(() => clear, []);
  return {
    onPointerDown(e: PointerEvent) {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      clear();
      t.current.fired = false;
      t.current.timeout = window.setTimeout(() => {
        t.current.fired = true;
        stepRef.current(10 * dir);
        t.current.interval = window.setInterval(() => stepRef.current(10 * dir), REPEAT_MS);
      }, LONG_PRESS_MS);
    },
    onPointerUp() {
      const fired = t.current.fired;
      const active = t.current.timeout !== undefined;
      clear();
      t.current.timeout = undefined;
      if (active && !fired) stepRef.current(dir);
    },
    onPointerCancel() {
      clear();
      t.current.timeout = undefined;
    },
    onContextMenu(e: Event) { e.preventDefault(); },
  };
}

export function PlayerPanel(props: { player: Player; onOpenSheet: () => void }) {
  const p = props.player;
  const g = game.value!;
  const s = snap.value!;
  const reason = lossReason(p);
  const active = s.activePlayerId === p.id;

  // transient delta badge
  const [delta, setDelta] = useState(0);
  const prev = useRef(p.life);
  const badgeTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (p.life !== prev.current) {
      setDelta((d) => d + (p.life - prev.current));
      prev.current = p.life;
      clearTimeout(badgeTimer.current);
      badgeTimer.current = window.setTimeout(() => setDelta(0), BADGE_MS);
    }
  }, [p.life]);
  useEffect(() => () => clearTimeout(badgeTimer.current), []);

  const adjust = (n: number) => {
    act({ type: 'adjustLife', playerId: p.id, delta: n });
    vibrate(10);
  };
  const minus = useHold(adjust, -1);
  const plus = useHold(adjust, 1);

  const tax = p.commanderCasts[0] * 2;
  const tax2 = p.commanderCasts[1] * 2;
  const warnTurn = active && s.overTurnLimit;

  return (
    <div
      class={`panel${reason ? ' out' : ''}${active ? ' active' : ''}${warnTurn ? ' over' : ''}`}
      style={{ '--pc': p.color }}
    >
      <Rotated rotation={p.rotation}>
        <div class="panel-inner">
          <div class="p-head">
            <div class="p-name">{p.name}</div>
            {active && <div class="p-turn">tura {formatMs(s.turnMs)}</div>}
          </div>
          <div class="zone zone-minus" {...minus}><span class="zone-hint">−</span></div>
          <div class="zone zone-plus" {...plus}><span class="zone-hint">+</span></div>
          <div class="life-wrap">
            <div class="life">{p.life}</div>
            {delta !== 0 && (
              <div class={`delta ${delta > 0 ? 'pos' : 'neg'}`}>
                {delta > 0 ? `+${delta}` : `−${-delta}`}
              </div>
            )}
          </div>
          {reason && <div class="reason">{REASON_LABEL[reason]}</div>}
          <button class="stats" onClick={props.onOpenSheet} aria-label="Liczniki">
            <span class="stat">☠ {p.poison}</span>
            <span class="stat">⚔ {tax}{p.hasPartner ? `/${tax2}` : ''}</span>
            {g.monarch === p.id && <span class="stat" title="Monarcha">👑</span>}
            {g.initiative === p.id && <span class="stat" title="Inicjatywa">🏰</span>}
            <span class="stat time">⏱ {formatMs(s.playerMs[p.id] ?? 0)}</span>
            <span class="stat more">⋯</span>
          </button>
        </div>
      </Rotated>
    </div>
  );
}
