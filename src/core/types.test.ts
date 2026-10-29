import { expect, test } from 'vitest';
import type { GameState } from './types';

test('contract compiles', () => {
  const v: GameState['version'] = 1;
  expect(v).toBe(1);
});
