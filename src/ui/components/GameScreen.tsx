import { useState } from 'preact/hooks';
import { game } from '../store';
import { CounterSheet } from './CounterSheet';
import { PlayerPanel } from './PlayerPanel';
import { TurnBar } from './TurnBar';
import { gridStyle } from './layout';

export function GameScreen() {
  const g = game.value;
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  if (!g) return null;
  return (
    <div class="game">
      <div class="grid" style={gridStyle(g.players.length)}>
        {g.players.map((p, i) => (
          <div key={p.id} class="cell" style={{ gridArea: `p${i}` }}>
            <PlayerPanel player={p} onOpenSheet={() => setSheetFor(p.id)} />
          </div>
        ))}
      </div>
      <TurnBar />
      {sheetFor && <CounterSheet playerId={sheetFor} onClose={() => setSheetFor(null)} />}
    </div>
  );
}
