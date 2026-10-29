import { describe, expect, it } from 'vitest';
import { cuesBetween } from './cues';

const S = 1000;
const M = 60_000;
const FULL = ['tick', 'tick', 'tick', 'countdown', 'countdown', 'countdown', 'countdown', 'countdown', 'timeout'];

describe('cuesBetween without a limit', () => {
  it('dings on each full minute only', () => {
    expect(cuesBetween(0, 59_999, null)).toEqual([]);
    expect(cuesBetween(59_000, 60_000, null)).toEqual(['minute']);
    expect(cuesBetween(60_000, 61_000, null)).toEqual([]);
    expect(cuesBetween(119_000, 121_000, null)).toEqual(['minute']);
  });
  it('uses (prev, now] boundaries', () => {
    expect(cuesBetween(0, 0, null)).toEqual([]);
    expect(cuesBetween(60_000, 60_000, null)).toEqual([]);
    expect(cuesBetween(59_999, 60_000, null)).toEqual(['minute']);
  });
  it('returns several minutes for a big jump', () => {
    expect(cuesBetween(0, 3 * M + 1, null)).toEqual(['minute', 'minute', 'minute']);
  });
  it('ignores backwards time', () => {
    expect(cuesBetween(70_000, 10_000, null)).toEqual([]);
  });
});

describe('cuesBetween with a 60 s limit', () => {
  const L = M;
  it('has no minute ding at 60 s: timeout instead', () => {
    expect(cuesBetween(59_000, 60_000, L)).toEqual(['timeout']);
  });
  it('tick at 30/20/10 s remaining', () => {
    expect(cuesBetween(29_999, 30_000, L)).toEqual(['tick']);
    expect(cuesBetween(39_999, 40_000, L)).toEqual(['tick']);
    expect(cuesBetween(49_999, 50_000, L)).toEqual(['tick']);
  });
  it('countdown at 5..1 s remaining', () => {
    for (const r of [5, 4, 3, 2, 1]) {
      expect(cuesBetween(L - r * S - 1, L - r * S, L)).toEqual(['countdown']);
    }
  });
  it('nothing between thresholds', () => {
    expect(cuesBetween(30_001, 39_999, L)).toEqual([]);
    expect(cuesBetween(50_001, 54_999, L)).toEqual([]);
  });
  it('a full-turn jump lists everything in order', () => {
    expect(cuesBetween(0, L, L)).toEqual(FULL);
  });
  it('continues with minute dings after the limit', () => {
    expect(cuesBetween(L, 2 * M, L)).toEqual(['minute']);
  });
});

describe('cuesBetween with a 90 s limit', () => {
  const L = 90_000;
  it('60 s mark (30 s remaining) is a tick, not a minute ding', () => {
    expect(cuesBetween(59_000, 60_000, L)).toEqual(['tick']);
  });
  it('full run', () => {
    expect(cuesBetween(0, L, L)).toEqual(FULL);
  });
});

describe('cuesBetween with a 3 min limit', () => {
  const L = 3 * M;
  it('dings at 1 and 2 min, not at 3 min', () => {
    expect(cuesBetween(0, L - 31 * S, L)).toEqual(['minute', 'minute']);
    expect(cuesBetween(L - 31 * S, L, L)).toEqual(FULL);
  });
  it('whole turn: 2 dings then the countdown', () => {
    expect(cuesBetween(0, L, L)).toEqual(['minute', 'minute', ...FULL]);
  });
});

describe('cuesBetween with a 2m30 limit', () => {
  it('120 s mark is 30 s before the limit: tick replaces the minute ding', () => {
    expect(cuesBetween(119_999, 120_000, 150_000)).toEqual(['tick']);
  });
});
