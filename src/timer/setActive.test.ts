import { expect, test } from 'vitest';
import { createClock, setActive, start } from './clock';

test('setActive on the already active player is a no-op', () => {
  const c = start(createClock(['a', 'b'], 'a'), 1000);
  expect(setActive(c, 'a', 5000)).toBe(c);
});
