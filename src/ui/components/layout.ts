/** Grid areas per player count; cell i holds players[i]. Rotation comes from player state. */
export function gridAreas(n: number): string[][] {
  switch (n) {
    case 2: return [['p0'], ['p1']];
    case 3: return [['p0', 'p0'], ['p1', 'p2']];
    case 4: return [['p0', 'p1'], ['p2', 'p3']];
    case 5: return [['p0', 'p1'], ['p2', 'p3'], ['p4', 'p4']];
    default: return [['p0', 'p1'], ['p2', 'p3'], ['p4', 'p5']];
  }
}

export function gridStyle(n: number) {
  const rows = gridAreas(n);
  return {
    gridTemplateAreas: rows.map((r) => `"${r.join(' ')}"`).join(' '),
    gridTemplateColumns: `repeat(${rows[0].length}, 1fr)`,
    gridTemplateRows: `repeat(${rows.length}, 1fr)`,
  };
}

export const REASON_LABEL = {
  life: 'Brak życia',
  poison: 'Trucizna',
  commander: 'Obrażenia od dowódcy',
  conceded: 'Poddał się',
} as const;

export const PALETTE = ['#e5484d', '#3b82f6', '#2fb36b', '#e8b931', '#a855f7', '#14b8c4'];
