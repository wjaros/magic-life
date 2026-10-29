import { GameScreen } from './components/GameScreen';
import { SetupScreen } from './components/SetupScreen';
import { game, screen } from './store';

export function App() {
  const showGame = screen.value === 'game' && game.value;
  return (
    <main class="app" onContextMenu={(e) => e.preventDefault()}>
      {showGame ? <GameScreen /> : <SetupScreen />}
    </main>
  );
}
