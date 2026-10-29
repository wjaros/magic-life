import { useEffect, useRef, useState } from 'preact/hooks';
import { formatMs } from '../engine';
import { act, canRedo, canUndo, game, redoAct, resetGame, screen, snap, undoAct, vibrate } from '../store';

export function TurnBar() {
  const g = game.value!;
  const s = snap.value!;
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState<null | 'reset'>(null);

  // one buzz when the turn limit is crossed
  const wasOver = useRef(false);
  useEffect(() => {
    if (s.overTurnLimit && !wasOver.current) vibrate(200);
    wasOver.current = s.overTurnLimit;
  }, [s.overTurnLimit]);

  const toggle = () => act({ type: s.running ? 'clockPause' : 'clockStart', now: Date.now() });
  const next = () => { act({ type: 'clockNextTurn', now: Date.now() }); vibrate(20); };
  const closeMenu = () => { setMenu(false); setConfirm(null); };
  const limit = g.settings.turnLimitMs;
  const seating = g.settings.seating ?? 'sides';

  return (
    <>
      <div class={`turnbar${g.players.length <= 3 ? ' wide' : ''}${s.overTurnLimit ? ' warn' : ''}${s.running ? '' : ' paused'}`}>
        <div class="tb-info">
          <span class="tb-time">{formatMs(s.gameMs)}</span>
          <span class="tb-turn">Tura {s.turn}</span>
          {limit != null && (
            <span class="tb-limit">{formatMs(s.turnMs)} / {formatMs(limit)}</span>
          )}
        </div>
        <button class="tb-btn tb-play" onClick={toggle} aria-label={s.running ? 'Pauza' : 'Start'}>{s.running ? '⏸' : '▶'}</button>
        <div class="tb-row">
          <button class="tb-btn" onClick={undoAct} disabled={!canUndo.value} aria-label="Cofnij">↶</button>
          <button class="tb-btn" onClick={() => setMenu(true)} aria-label="Menu">☰</button>
        </div>
        <button class="tb-next" onClick={next}>Następna tura</button>
      </div>

      {menu && (
        <div class="overlay center" onClick={closeMenu}>
          <div class="menu" onClick={(e) => e.stopPropagation()}>
            <h2>Menu</h2>
            <button class="btn" onClick={() => { redoAct(); }} disabled={!canRedo.value}>↷ Ponów</button>
            {g.players.length > 2 && (
              <button
                class="btn"
                onClick={() => act({ type: 'setSeating', seating: seating === 'ends' ? 'sides' : 'ends' })}
              >
                Układ: {seating === 'ends' ? 'na końcach' : 'wzdłuż'} ⇄
              </button>
            )}
            <button
              class="btn danger"
              onClick={() => {
                if (confirm !== 'reset') return setConfirm('reset');
                resetGame(); closeMenu();
              }}
            >
              {confirm === 'reset' ? 'Na pewno? Zresetuj' : 'Resetuj grę'}
            </button>
            <button class="btn" onClick={() => { closeMenu(); screen.value = 'setup'; }}>
              Nowa gra
            </button>
            <button class="btn primary" onClick={closeMenu}>Zamknij</button>
          </div>
        </div>
      )}
    </>
  );
}
