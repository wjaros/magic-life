import type { Action, CommanderSlot, Player } from '../../core/types';
import { act, game, vibrate } from '../store';
import { Rotated } from './Rotated';

function Stepper(props: { label: string; value: number; onChange: (d: number) => void; color?: string }) {
  const go = (d: number) => { props.onChange(d); vibrate(10); };
  return (
    <div class="srow">
      <span class="slabel">
        {props.color && <i class="dot" style={{ background: props.color }} />}
        {props.label}
      </span>
      <button class="sbtn" onClick={() => go(-1)} aria-label={`${props.label} minus`}>−</button>
      <span class="sval">{props.value}</span>
      <button class="sbtn" onClick={() => go(1)} aria-label={`${props.label} plus`}>+</button>
    </div>
  );
}

export function CounterSheet(props: { playerId: string; onClose: () => void }) {
  const g = game.value!;
  const p: Player | undefined = g.players.find((x) => x.id === props.playerId);
  if (!p) return null;
  const slots: CommanderSlot[] = p.hasPartner ? [0, 1] : [0];
  const send = (a: Action) => act(a);
  const opponents = g.players.filter((o) => o.id !== p.id);

  return (
    <div class="overlay" onClick={props.onClose}>
      <Rotated rotation={p.rotation}>
        <div class="sheet-host">
          <div class="sheet" style={{ '--pc': p.color }} onClick={(e) => e.stopPropagation()}>
            <header class="sheet-head">
              <b>{p.name}</b>
              <span class="sheet-life">{p.life}</span>
              <button class="btn primary" onClick={props.onClose}>Gotowe</button>
            </header>

            <section>
              <Stepper label="Trucizna" value={p.poison} onChange={(d) => send({ type: 'adjustPoison', playerId: p.id, delta: d })} />
              <Stepper label="Energia" value={p.energy} onChange={(d) => send({ type: 'adjustEnergy', playerId: p.id, delta: d })} />
              <Stepper label="Doświadczenie" value={p.experience} onChange={(d) => send({ type: 'adjustExperience', playerId: p.id, delta: d })} />
              {slots.map((slot) => (
                <Stepper
                  key={slot}
                  label={p.hasPartner ? `Rzuty dowódcy ${slot + 1} (podatek ${p.commanderCasts[slot] * 2})` : `Rzuty dowódcy (podatek ${p.commanderCasts[slot] * 2})`}
                  value={p.commanderCasts[slot]}
                  onChange={(d) => send({ type: 'adjustCommanderCasts', playerId: p.id, slot, delta: d })}
                />
              ))}
            </section>

            {opponents.length > 0 && (
              <section>
                <h3>Obrażenia od dowódców</h3>
                {opponents.map((o) =>
                  ((o.hasPartner ? [0, 1] : [0]) as CommanderSlot[]).map((slot) => (
                    <Stepper
                      key={`${o.id}-${slot}`}
                      color={o.color}
                      label={o.hasPartner ? `${o.name} (${slot + 1})` : o.name}
                      value={p.commanderDamage[o.id]?.[slot] ?? 0}
                      onChange={(d) => send({ type: 'adjustCommanderDamage', targetId: p.id, sourceId: o.id, slot, delta: d })}
                    />
                  )),
                )}
              </section>
            )}

            <section class="toggles">
              <button
                class={`btn${g.monarch === p.id ? ' on' : ''}`}
                onClick={() => send({ type: 'setMonarch', playerId: g.monarch === p.id ? null : p.id })}
              >
                👑 Monarcha
              </button>
              <button
                class={`btn${g.initiative === p.id ? ' on' : ''}`}
                onClick={() => send({ type: 'setInitiative', playerId: g.initiative === p.id ? null : p.id })}
              >
                🏰 Inicjatywa
              </button>
              <button
                class={`btn danger${p.conceded ? ' on' : ''}`}
                onClick={() => { send({ type: 'setConceded', playerId: p.id, conceded: !p.conceded }); if (!p.conceded) props.onClose(); }}
              >
                {p.conceded ? 'Wróć do gry' : 'Poddaj się'}
              </button>
            </section>
          </div>
        </div>
      </Rotated>
    </div>
  );
}
