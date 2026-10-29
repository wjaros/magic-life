import { describe, expect, it } from 'vitest';
import { randomInt, stepDelay } from './firstPlayer';

describe('randomInt', () => {
  it('stays in range and hits every value', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = randomInt(4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(4);
      seen.add(v);
    }
    expect(seen.size).toBe(4);
    expect(randomInt(1)).toBe(0);
  });
});

describe('stepDelay', () => {
  it('speeds up then slows down, total roughly 1.5-2.2 s', () => {
    const steps = 15;
    const d = Array.from({ length: steps }, (_, i) => stepDelay(i + 1, steps));
    expect(d[4]!).toBeLessThan(d[0]!);
    expect(d[steps - 1]!).toBeGreaterThan(d[4]!);
    const total = d.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(1500);
    expect(total).toBeLessThan(2300);
  });
});
