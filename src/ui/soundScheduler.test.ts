import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cue } from '../timer/cues';
import { startSoundScheduler, type CueSource } from './soundScheduler';

describe('sound scheduler', () => {
  let t = 0;
  let src: CueSource | null;
  let played: Cue[];
  const start = () =>
    startSoundScheduler({ source: () => src && { ...src, turnMs: t }, play: (c) => played.push(c) });

  beforeEach(() => {
    vi.useFakeTimers();
    t = 0;
    played = [];
    src = { key: 'a', turnMs: 0, limitMs: 60_000 };
  });
  afterEach(() => vi.useRealTimers());

  const advance = (ms: number) => { t += ms; vi.advanceTimersByTime(ms); };

  it('plays a cue when a threshold is crossed', () => {
    const s = start();
    advance(29_800);
    expect(played).toEqual([]);
    advance(400);
    expect(played).toEqual(['tick']);
    s.stop();
  });

  it('plays only the last cue after a short lag burst', () => {
    const s = start();
    advance(200);
    t = 54_400; // jumped without ticking
    s.tick();
    // window (52.9s, 54.4s]: no thresholds
    expect(played).toEqual([]);
    t = 57_400;
    s.tick(); // 57 s crossing is within 1.5 s of now -> countdown (3 s remaining)
    expect(played).toEqual(['countdown']);
    s.stop();
  });

  it('drops stale crossings (tab was throttled)', () => {
    const s = start();
    advance(200);
    t = 45_000; // jumped past 30 s and 40 s
    s.tick();
    expect(played).toEqual([]);
    s.stop();
  });

  it('resets on key change and when the source goes null', () => {
    const s = start();
    advance(29_000);
    src = { key: 'b', turnMs: 0, limitMs: 60_000 };
    advance(1_500);
    expect(played).toEqual([]); // new turn: baseline set, 30 s mark is not crossed
    src = null;
    advance(5_000);
    src = { key: 'b', turnMs: 0, limitMs: 60_000 };
    advance(200);
    expect(played).toEqual([]);
    s.stop();
  });

  it('stop halts polling', () => {
    const s = start();
    s.stop();
    advance(60_000);
    expect(played).toEqual([]);
  });
});
