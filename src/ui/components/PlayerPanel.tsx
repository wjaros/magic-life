import { useEffect, useRef, useState } from 'preact/hooks';
import type { Player } from '../../core/types';
import { formatMs, lossReason } from '../engine';
import { act, game, snap, vibrate } from '../store';
import { Rotated } from './Rotated';
import { useHold } from '../useHold';
import { REASON_LABEL } from './layout';

const BADGE_MS = 2000;

export function PlayerPanel(props: { player: Player; onOpenSheet: () => void }) {
  const p = props.player;
  const g = game.value!;
  const s = snap.value!;
  const reason = lossReason(p);
  const active = s.activePlayerId === p.id;

  // transient delta badge
  const [delta, setDelta] = useState(0);
  const prev = useRef(p.life);
  const prevGame = useRef(g.createdAt);
  const badgeTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (prevGame.current !== g.createdAt) {
      // New game / reset: life jumps are not a delta worth showing.
      prevGame.current = g.createdAt;
      prev.current = p.life;
      clearTimeout(badgeTimer.current);
      setDelta(0);
      return;
    }
    if (p.life !== prev.current) {
      setDelta((d) => d + (p.life - prev.current));
      prev.current = p.life;
      clearTimeout(badgeTimer.current);
      badgeTimer.current = window.setTimeout(() => setDelta(0), BADGE_MS);
    }
  }, [p.life, g.createdAt]);
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
          <div
            class="zone zone-minus" role="button" tabIndex={0}
            aria-label={`Gracz ${p.name}: życie −1`} {...minus}
          ><span class="zone-hint">−</span></div>
          <div
            class="zone zone-plus" role="button" tabIndex={0}
            aria-label={`Gracz ${p.name}: życie +1`} {...plus}
          ><span class="zone-hint">+</span></div>
          <div class="life-wrap">
            <div class="life" aria-live="polite">{p.life}</div>
            {delta !== 0 && (
              <div class={`delta ${delta > 0 ? 'pos' : 'neg'}`}>
                {delta > 0 ? `+${delta}` : `−${-delta}`}
              </div>
            )}
          </div>
          {reason && <div class="reason">{REASON_LABEL[reason]}</div>}
          <button class="stats" onClick={props.onOpenSheet} aria-label={`Liczniki gracza ${p.name}: trucizna ${p.poison}, podatek dowódcy ${tax}${p.hasPartner ? `/${tax2}` : ''}, czas ${formatMs(s.playerMs[p.id] ?? 0)}`}
          >
            <span class="stat">☠ {p.poison}</span>
            <span class="stat" title="Podatek dowódcy">Tax {tax}{p.hasPartner ? `/${tax2}` : ''}</span>
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
