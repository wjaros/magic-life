// TEMP stubs — replaced by re-exports from core/timer at integration
// (core/game.ts, core/history.ts, core/rules.ts, timer/clock.ts). Signatures match src/core/api.ts.
import type {
  Action, ClockSnapshot, ClockState, GameSettings, GameState, History, Player, PlayerId,
  PlayerSetup, Rotation,
} from '../core/types';

const ROTATIONS: Record<number, Rotation[]> = {
  2: [180, 0],
  3: [180, 90, 270],
  4: [90, 270, 90, 270],
  5: [90, 270, 90, 270, 0],
  6: [90, 270, 90, 270, 90, 270],
};

function emptyClock(ids: PlayerId[]): ClockState {
  return {
    running: false,
    activePlayerId: ids[0] ?? null,
    turn: 1,
    segmentStartedAt: null,
    gameElapsedMs: 0,
    playerElapsedMs: Object.fromEntries(ids.map((i) => [i, 0])),
    turnElapsedMs: 0,
  };
}

export function createGame(players: PlayerSetup[], settings: GameSettings, now: number): GameState {
  const rots = ROTATIONS[players.length] ?? ROTATIONS[4];
  const list: Player[] = players.map((p, i) => ({
    id: `p${i + 1}`,
    name: p.name,
    color: p.color,
    life: settings.startingLife,
    poison: 0,
    commanderCasts: [0, 0],
    hasPartner: !!p.hasPartner,
    energy: 0,
    experience: 0,
    commanderDamage: {},
    conceded: false,
    rotation: rots[i % rots.length],
  }));
  return {
    version: 1,
    settings,
    players: list,
    monarch: null,
    initiative: null,
    clock: emptyClock(list.map((p) => p.id)),
    createdAt: now,
  };
}

function flush(c: ClockState, now: number): ClockState {
  if (!c.running || c.segmentStartedAt == null) return c;
  const d = Math.max(0, now - c.segmentStartedAt);
  const pe = { ...c.playerElapsedMs };
  if (c.activePlayerId) pe[c.activePlayerId] = (pe[c.activePlayerId] ?? 0) + d;
  return {
    ...c,
    segmentStartedAt: now,
    gameElapsedMs: c.gameElapsedMs + d,
    turnElapsedMs: c.turnElapsedMs + d,
    playerElapsedMs: pe,
  };
}

function reduceClock(s: GameState, a: Action): ClockState {
  const c = s.clock;
  switch (a.type) {
    case 'clockStart':
      return c.running ? c : { ...c, running: true, segmentStartedAt: a.now };
    case 'clockPause':
      return c.running ? { ...flush(c, a.now), running: false, segmentStartedAt: null } : c;
    case 'clockNextTurn': {
      const f = flush(c, a.now);
      const ids = s.players.map((p) => p.id);
      const alive = new Set(alivePlayers(s).map((p) => p.id));
      const idx = ids.indexOf(f.activePlayerId ?? '');
      let next = f.activePlayerId;
      for (let k = 1; k <= ids.length; k++) {
        const cand = ids[(idx + k) % ids.length];
        if (alive.has(cand)) { next = cand; break; }
      }
      return { ...f, activePlayerId: next, turn: f.turn + 1, turnElapsedMs: 0 };
    }
    case 'clockSetActive':
      return { ...flush(c, a.now), activePlayerId: a.playerId, turnElapsedMs: 0 };
    default:
      return c;
  }
}

const bump = (n: number, d: number) => Math.max(0, n + d);

function reduce(s: GameState, a: Action): GameState {
  const mapP = (id: PlayerId, f: (p: Player) => Player): GameState => ({
    ...s,
    players: s.players.map((p) => (p.id === id ? f(p) : p)),
  });
  switch (a.type) {
    case 'newGame':
      return createGame(a.players, a.settings, a.now);
    case 'adjustLife':
      return mapP(a.playerId, (p) => ({ ...p, life: p.life + a.delta }));
    case 'adjustPoison':
      return mapP(a.playerId, (p) => ({ ...p, poison: bump(p.poison, a.delta) }));
    case 'adjustEnergy':
      return mapP(a.playerId, (p) => ({ ...p, energy: bump(p.energy, a.delta) }));
    case 'adjustExperience':
      return mapP(a.playerId, (p) => ({ ...p, experience: bump(p.experience, a.delta) }));
    case 'adjustCommanderCasts':
      return mapP(a.playerId, (p) => {
        const c: [number, number] = [...p.commanderCasts];
        c[a.slot] = bump(c[a.slot], a.delta);
        return { ...p, commanderCasts: c };
      });
    case 'adjustCommanderDamage':
      return mapP(a.targetId, (p) => {
        const cur: [number, number] = [...(p.commanderDamage[a.sourceId] ?? [0, 0])];
        const nv = bump(cur[a.slot], a.delta);
        const real = nv - cur[a.slot];
        cur[a.slot] = nv;
        return { ...p, life: p.life - real, commanderDamage: { ...p.commanderDamage, [a.sourceId]: cur } };
      });
    case 'setMonarch':
      return { ...s, monarch: a.playerId };
    case 'setInitiative':
      return { ...s, initiative: a.playerId };
    case 'setConceded':
      return mapP(a.playerId, (p) => ({ ...p, conceded: a.conceded }));
    case 'renamePlayer':
      return mapP(a.playerId, (p) => ({ ...p, name: a.name }));
    case 'setColor':
      return mapP(a.playerId, (p) => ({ ...p, color: a.color }));
    case 'setPartner':
      return mapP(a.playerId, (p) => ({ ...p, hasPartner: a.hasPartner }));
    default:
      return { ...s, clock: reduceClock(s, a) };
  }
}

export function initHistory(state: GameState): History {
  return { past: [], present: state, future: [] };
}

export function dispatch(h: History, a: Action): History {
  const next = reduce(h.present, a);
  if (next === h.present) return h;
  return { past: [...h.past.slice(-199), h.present], present: next, future: [] };
}

export function undo(h: History): History {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

export function lossReason(p: Player): null | 'life' | 'poison' | 'commander' | 'conceded' {
  if (p.conceded) return 'conceded';
  if (p.life <= 0) return 'life';
  if (p.poison >= 10) return 'poison';
  if (Object.values(p.commanderDamage).some((d) => d[0] >= 21 || d[1] >= 21)) return 'commander';
  return null;
}

export function alivePlayers(s: GameState): Player[] {
  return s.players.filter((p) => lossReason(p) === null);
}

export function snapshot(clock: ClockState, now: number, turnLimitMs: number | null): ClockSnapshot {
  const f = flush(clock, now);
  return {
    running: clock.running,
    activePlayerId: clock.activePlayerId,
    turn: clock.turn,
    gameMs: f.gameElapsedMs,
    turnMs: f.turnElapsedMs,
    playerMs: f.playerElapsedMs,
    overTurnLimit: turnLimitMs != null && f.turnElapsedMs > turnLimitMs,
  };
}

/** "m:ss" or "h:mm:ss". */
export function formatMs(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
