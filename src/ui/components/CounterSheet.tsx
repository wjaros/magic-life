import { useState } from 'preact/hooks';
import { MAX_PINNED } from '../../core/types';
import type { Action, CommanderSlot, CustomCounter, PinKey, Player } from '../../core/types';
import { act, game, vibrate } from '../store';
import { useHold } from '../useHold';
import { Rotated } from './Rotated';

/** hold: tap ±1, holding repeats ±1 every 150 ms (fine-grained, for poison / commander damage). */
function Stepper(props: {
  label: string; value: number; onChange: (d: number) => void; color?: string; hold?: boolean;
  pin?: { on: boolean; disabled: boolean; toggle: () => void };
}) {
  const go = (d: number) => { props.onChange(d); vibrate(10); };
  const minus = useHold(go, -1, { holdStep: 1, repeatMs: 150 });
  const plus = useHold(go, 1, { holdStep: 1, repeatMs: 150 });
  const bind = (h: ReturnType<typeof useHold>, d: number) =>
    props.hold ? h : { onClick: () => go(d) };
  return (
    <div class="srow">
      <span class="slabel">
        {props.color && <i class="dot" style={{ background: props.color }} />}
        {props.label}
      </span>
      {props.pin && <PinToggle label={props.label} {...props.pin} />}
      <button class="sbtn" {...bind(minus, -1)} aria-label={`${props.label} minus`}>−</button>
      <span class="sval">{props.value}</span>
      <button class="sbtn" {...bind(plus, 1)} aria-label={`${props.label} plus`}>+</button>
    </div>
  );
}

function PinToggle(props: { label: string; on: boolean; disabled: boolean; toggle: () => void }) {
  return (
    <button
      class={`pinbtn${props.on ? ' on' : ''}`}
      aria-pressed={props.on}
      aria-label={`${props.label}: przypnij do panelu`}
      title={props.disabled && !props.on ? 'maks. 2' : 'Przypnij do panelu'}
      disabled={props.disabled && !props.on}
      onClick={props.toggle}
    >📌</button>
  );
}

function CustomRow(props: {
  player: Player; counter: CustomCounter; pin: { on: boolean; disabled: boolean; toggle: () => void };
}) {
  const { player: p, counter: c } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.name);
  const commit = () => {
    if (!editing) return;
    setEditing(false);
    act({ type: 'renameCustomCounter', playerId: p.id, counterId: c.id, name: draft });
  };
  const go = (d: number) => { act({ type: 'adjustCustomCounter', playerId: p.id, counterId: c.id, delta: d }); vibrate(10); };
  const minus = useHold(go, -1, { holdStep: 1, repeatMs: 150 });
  const plus = useHold(go, 1, { holdStep: 1, repeatMs: 150 });
  return (
    <div class="crow">
      {editing ? (
        <input
          class="cname-input" value={draft} maxLength={24} autoFocus
          aria-label={`Nazwa licznika ${c.name}`}
          onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span class="cname">{c.name}</span>
      )}
      <button class="ibtn" aria-label={`${c.name}: zmień nazwę`} onMouseDown={(e) => e.preventDefault()}
        onClick={() => { if (editing) commit(); else { setDraft(c.name); setEditing(true); } }}>✎</button>
      <button class="ibtn" aria-label={`${c.name}: usuń`}
        onClick={() => act({ type: 'removeCustomCounter', playerId: p.id, counterId: c.id })}>🗑</button>
      <PinToggle label={c.name} {...props.pin} />
      <div class="cstep">
        <button class="sbtn" {...minus} aria-label={`${c.name} minus`}>−</button>
        <span class="sval">{c.value}</span>
        <button class="sbtn" {...plus} aria-label={`${c.name} plus`}>+</button>
      </div>
    </div>
  );
}

function AddCounter(props: { playerId: string }) {
  const [name, setName] = useState('');
  const add = () => {
    if (!name.trim()) return;
    act({ type: 'addCustomCounter', playerId: props.playerId, name });
    setName('');
  };
  return (
    <div class="addc">
      <input
        class="cname-input" value={name} maxLength={24} placeholder="Nazwa licznika"
        aria-label="Nazwa nowego licznika"
        onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
      />
      <button class="btn" disabled={!name.trim()} onClick={add}>Dodaj licznik</button>
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
  const pinFor = (key: PinKey) => {
    const on = p.pinned.includes(key);
    return {
      on,
      disabled: !on && p.pinned.length >= MAX_PINNED,
      toggle: () =>
        send({
          type: 'setPinned', playerId: p.id,
          pinned: on ? p.pinned.filter((k) => k !== key) : [...p.pinned, key],
        }),
    };
  };

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
                <CustomRow key={c.id} player={p} counter={c} pin={pinFor(c.id)} />
              ))}
              <AddCounter playerId={p.id} />
              <p class="hint">Przypięte liczniki są zawsze widoczne na panelu (maks. {MAX_PINNED}).</p>
            </section>

            {opponents.length > 0 && (
              <section>
                <h3>Obrażenia od dowódców</h3>
                {opponents.map((o) =>
                  ((o.hasPartner ? [0, 1] : [0]) as CommanderSlot[]).map((slot) => (
                    <Stepper
                      hold
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
              <button class="btn" onClick={() => send({ type: 'rotatePlayer', playerId: p.id })}>
                Obróć panel ⟳
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
