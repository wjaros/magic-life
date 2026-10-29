import { useState } from 'preact/hooks';
import { MAX_PINNED } from '../../core/types';
import type { Action, CommanderSlot, PinKey } from '../../core/types';
import { remote } from '../../net/remote';
import { useHold } from '../useHold';
import { vibrate } from './parts';

function Stepper(props: {
  label: string; value: number; onChange: (d: number) => void; color?: string; hold?: boolean;
  pin?: { on: boolean; disabled: boolean; toggle: () => void };
  extra?: preact.ComponentChildren;
}) {
  const go = (d: number) => { props.onChange(d); vibrate(10); };
  const minus = useHold(go, -1, { holdStep: 1, repeatMs: 150 });
  const plus = useHold(go, 1, { holdStep: 1, repeatMs: 150 });
  const bind = (h: ReturnType<typeof useHold>, d: number) => (props.hold ? h : { onClick: () => go(d) });
  return (
    <div class="srow">
      <span class="slabel">
        {props.color && <i class="dot" style={{ background: props.color }} />}
        {props.label}
      </span>
      {props.extra}
      {props.pin && (
        <button
          class={`pinbtn${props.pin.on ? ' on' : ''}`} aria-pressed={props.pin.on}
          aria-label={`${props.label}: przypnij do panelu`}
          disabled={props.pin.disabled && !props.pin.on} onClick={props.pin.toggle}
        >📌</button>
      )}
      <button class="sbtn" {...bind(minus, -1)} aria-label={`${props.label} minus`}>−</button>
      <span class="sval">{props.value}</span>
      <button class="sbtn" {...bind(plus, 1)} aria-label={`${props.label} plus`}>+</button>
    </div>
  );
}

/** Counter sheet for the phone's own player; every change goes to the host as an action. */
export function RemoteSheet(props: { playerId: string; onClose: () => void }) {
  const g = remote.game.value!;
  const p = g.players.find((x) => x.id === props.playerId);
  const [newName, setNewName] = useState('');
  if (!p) return null;
  const send = (a: Action) => remote.act(a);
  const slots: CommanderSlot[] = p.hasPartner ? [0, 1] : [0];
  const opponents = g.players.filter((o) => o.id !== p.id);
  const pinFor = (key: PinKey) => {
    const on = p.pinned.includes(key);
    return {
      on,
      disabled: !on && p.pinned.length >= MAX_PINNED,
      toggle: () => send({ type: 'setPinned', playerId: p.id, pinned: on ? p.pinned.filter((k) => k !== key) : [...p.pinned, key] }),
    };
  };
  const addCounter = () => {
    if (!newName.trim()) return;
    send({ type: 'addCustomCounter', playerId: p.id, name: newName });
    setNewName('');
  };

  return (
    <div class="r-overlay" onClick={props.onClose}>
      <div class="sheet r-sheet" style={{ '--pc': p.color }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Liczniki">
        <header class="sheet-head">
          <b>{p.name}</b>
          <span class="sheet-life">{p.life}</span>
          <button class="btn primary" onClick={props.onClose}>Gotowe</button>
        </header>

        <section>
          <Stepper hold pin={pinFor('poison')} label="Trucizna" value={p.poison} onChange={(d) => send({ type: 'adjustPoison', playerId: p.id, delta: d })} />
          <Stepper pin={pinFor('energy')} label="Energia" value={p.energy} onChange={(d) => send({ type: 'adjustEnergy', playerId: p.id, delta: d })} />
          <Stepper pin={pinFor('experience')} label="Doświadczenie" value={p.experience} onChange={(d) => send({ type: 'adjustExperience', playerId: p.id, delta: d })} />
          {slots.map((slot) => (
            <Stepper
              key={slot}
              pin={slot === 0 ? pinFor('tax') : undefined}
              label={p.hasPartner ? `Rzuty dowódcy ${slot + 1} (podatek ${p.commanderCasts[slot] * 2})` : `Rzuty dowódcy (podatek ${p.commanderCasts[slot] * 2})`}
              value={p.commanderCasts[slot]}
              onChange={(d) => send({ type: 'adjustCommanderCasts', playerId: p.id, slot, delta: d })}
            />
          ))}
        </section>

        <section class="customs">
          <h3>Własne liczniki</h3>
          {p.customCounters.map((c) => (
            <Stepper
              key={c.id} label={c.name} value={c.value} pin={pinFor(c.id)}
              extra={<button class="ibtn" aria-label={`${c.name}: usuń`} onClick={() => send({ type: 'removeCustomCounter', playerId: p.id, counterId: c.id })}>🗑</button>}
              onChange={(d) => send({ type: 'adjustCustomCounter', playerId: p.id, counterId: c.id, delta: d })}
            />
          ))}
          <div class="addc">
            <input
              class="cname-input" value={newName} maxLength={24} placeholder="Nazwa licznika" aria-label="Nazwa nowego licznika"
              onInput={(e) => setNewName((e.currentTarget as HTMLInputElement).value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addCounter(); }}
            />
            <button class="btn" disabled={!newName.trim()} onClick={addCounter}>Dodaj licznik</button>
          </div>
        </section>

        {opponents.length > 0 && (
          <section>
            <h3>Obrażenia od dowódców</h3>
            {opponents.map((o) =>
              ((o.hasPartner ? [0, 1] : [0]) as CommanderSlot[]).map((slot) => (
                <Stepper
                  hold key={`${o.id}-${slot}`} color={o.color}
                  label={o.hasPartner ? `${o.name} (${slot + 1})` : o.name}
                  value={p.commanderDamage[o.id]?.[slot] ?? 0}
                  onChange={(d) => send({ type: 'adjustCommanderDamage', targetId: p.id, sourceId: o.id, slot, delta: d })}
                />
              )),
            )}
          </section>
        )}

        <section class="toggles">
          <button class={`btn${g.monarch === p.id ? ' on' : ''}`} onClick={() => send({ type: 'setMonarch', playerId: g.monarch === p.id ? null : p.id })}>
            👑 Monarcha
          </button>
          <button class={`btn${g.initiative === p.id ? ' on' : ''}`} onClick={() => send({ type: 'setInitiative', playerId: g.initiative === p.id ? null : p.id })}>
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
  );
}
