import { describe, expect, it } from 'vitest';
import { burnTiming, formatClock, trimSamples, type BurnSample } from './burnTiming';

/** Samples at a steady rate, `ms` apart, starting at t=0. */
function steady(count: number, sectorsPerSec: number, ms = 1000): BurnSample[] {
  return Array.from({ length: count }, (_, i) => ({
    at: i * ms,
    sectorsDone: Math.round((i * ms * sectorsPerSec) / 1000),
  }));
}

describe('burnTiming', () => {
  it('shows nothing before the laser starts', () => {
    const t = burnTiming([], 1000, 5000, null);
    expect(t.elapsedSec).toBeNull();
    expect(t.remainingSec).toBeNull();
    expect(t.totalSec).toBeNull();
  });

  it('reports elapsed before it can estimate anything else', () => {
    // One sample is not enough to divide by.
    const t = burnTiming(steady(1, 100), 10_000, 4000, 0);
    expect(t.elapsedSec).toBe(4);
    expect(t.remainingSec).toBeNull();
  });

  it('will not estimate from a window too short to trust', () => {
    // A drive's opening moments are not its real rate.
    const t = burnTiming(steady(2, 100, 200), 10_000, 400, 0);
    expect(t.remainingSec).toBeNull();
  });

  it('derives the rate from the sectors actually reported', () => {
    const samples = steady(13, 100); // 100 sectors/s over 12s
    const t = burnTiming(samples, 10_000, 12_000, 0);
    expect(t.sectorsPerSec).toBeCloseTo(100, 1);
    // 1200 written, 8800 left at 100/s.
    expect(t.remainingSec).toBeCloseTo(88, 0);
  });

  it('totals to elapsed plus remaining, so the two never disagree', () => {
    const t = burnTiming(steady(13, 100), 10_000, 12_000, 0);
    expect(t.totalSec).toBeCloseTo((t.elapsedSec ?? 0) + (t.remainingSec ?? 0), 5);
  });

  it('follows a drive that slows down rather than averaging it away', () => {
    // A minute at 1000 sectors/s, then a tenth of that for the 12s the window
    // covers, which is the shape of a drive dropping speed towards the rim.
    const fast = steady(61, 1000);
    const slow: BurnSample[] = Array.from({ length: 12 }, (_, i) => ({
      at: 60_000 + (i + 1) * 1000,
      sectorsDone: 60_000 + (i + 1) * 100,
    }));
    const windowed = trimSamples([...fast, ...slow], 72_000);
    const t = burnTiming(windowed, 100_000, 72_000, 0);
    // The window sees only the slow tail and reads 100/s. Averaging the whole
    // run instead would divide 61_200 sectors by 72s, call the rate 850/s, and
    // promise the remaining 38_800 in three quarters of a minute when the drive
    // needs six and a half.
    expect(t.sectorsPerSec).toBeCloseTo(100, 1);
    expect(t.remainingSec).toBeCloseTo(388, 0);
  });

  it('never reports negative time left once the disc is done', () => {
    const samples: BurnSample[] = [
      { at: 0, sectorsDone: 9000 },
      { at: 5000, sectorsDone: 10_500 },
    ];
    const t = burnTiming(samples, 10_000, 5000, 0);
    expect(t.remainingSec).toBe(0);
  });

  it('refuses to divide by a rate that is really a stall', () => {
    const stalled: BurnSample[] = [
      { at: 0, sectorsDone: 500 },
      { at: 10_000, sectorsDone: 500 },
    ];
    expect(burnTiming(stalled, 10_000, 10_000, 0).remainingSec).toBeNull();
  });
});

describe('trimSamples', () => {
  it('drops what has aged out of the window', () => {
    const samples = steady(30, 100);
    const kept = trimSamples(samples, 29_000);
    expect(kept.length).toBeLessThan(samples.length);
    expect(kept[0].at).toBeGreaterThanOrEqual(29_000 - 12_000);
  });

  it('keeps a pair even when events are slower than the window', () => {
    // A drive reporting once a minute must still be measurable.
    const sparse: BurnSample[] = [
      { at: 0, sectorsDone: 0 },
      { at: 60_000, sectorsDone: 6000 },
    ];
    expect(trimSamples(sparse, 120_000)).toHaveLength(2);
  });
});

describe('formatClock', () => {
  it('pads to mm:ss', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(65)).toBe('01:05');
    expect(formatClock(600)).toBe('10:00');
  });

  it('shows a dash rather than a made-up number', () => {
    expect(formatClock(null)).toBe('—');
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
