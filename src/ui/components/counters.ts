import type { BuiltinCounter, PinKey, Player } from '../../core/types';

export const BUILTIN_META: Record<BuiltinCounter, { label: string; short: string }> = {
  energy: { label: 'Energia', short: '⚡' },
  experience: { label: 'Doświadczenie', short: '✦' },
  poison: { label: 'Trucizna', short: '☠' },
  tax: { label: 'Tax', short: 'Tax' },
};

export const BUILTIN_ORDER: BuiltinCounter[] = ['energy', 'experience', 'poison', 'tax'];

export const isBuiltinKey = (k: PinKey): k is BuiltinCounter => k in BUILTIN_META;

/** Display data for one pinned counter, or null when the key no longer resolves. */
export function resolvePinned(
  p: Player,
  key: PinKey,
): { short: string; label: string; display: string } | null {
  if (isBuiltinKey(key)) {
    const m = BUILTIN_META[key];
    let display: string;
    switch (key) {
      case 'energy': display = String(p.energy); break;
      case 'experience': display = String(p.experience); break;
      case 'poison': display = String(p.poison); break;
      case 'tax':
        display = p.hasPartner
          ? `${p.commanderCasts[0] * 2}/${p.commanderCasts[1] * 2}`
          : String(p.commanderCasts[0] * 2);
        break;
    }
    return { short: m.short, label: m.label, display };
  }
  const c = p.customCounters.find((x) => x.id === key);
  return c ? { short: c.name, label: c.name, display: String(c.value) } : null;
}
