import { describe, expect, it } from 'vitest';
import { createDemoSpectrum, sampleDemoSpectrum, type DemoSpectrum } from './demoSpectrum';

const PARAMS = { fps: 60, responsiveness: 0.65 };
const FRAME_MS = 1_000 / 60;

/** Low bands, where the kick lands (roughly 40–70 Hz). */
function kickLevel(demo: DemoSpectrum): number {
  let sum = 0;
  for (let b = 8; b <= 18; b++) sum += demo.frame.bands[b]!;
  return sum / 11;
}

/** Step a demo at display rate from `fromMs` to `toMs` inclusive. */
function run(demo: DemoSpectrum, fromMs: number, toMs: number, params = PARAMS): void {
  for (let now = fromMs; now <= toMs; now += FRAME_MS) sampleDemoSpectrum(demo, now, params);
}

describe('demo spectrum', () => {
  it('produces a signal in the frame’s unit ranges', () => {
    const demo = createDemoSpectrum();
    run(demo, 10_000, 11_000);

    const bands = [...demo.frame.bands];
    expect(Math.max(...bands)).toBeGreaterThan(0.3);
    expect(bands.every(v => v >= 0 && v <= 1)).toBe(true);
    expect([...demo.frame.peaks].every(v => v >= 0 && v <= 1)).toBe(true);
    for (const trace of [demo.frame.waveform, demo.frame.waveformLeft, demo.frame.waveformRight]) {
      const values = [...trace];
      expect(values.every(v => v >= -1 && v <= 1)).toBe(true);
      expect(Math.max(...values.map(Math.abs))).toBeGreaterThan(0.1);
    }
    expect(demo.frame.rms).toBeGreaterThan(0);
  });

  it('is deterministic in time', () => {
    const a = createDemoSpectrum();
    const b = createDemoSpectrum();
    run(a, 5_000, 5_400);
    run(b, 5_000, 5_400);
    expect([...a.frame.bands]).toEqual([...b.frame.bands]);
    expect([...a.frame.waveformLeft]).toEqual([...b.frame.waveformLeft]);
  });

  it('hits on the beat and falls away between beats', () => {
    const demo = createDemoSpectrum();
    // 20 s is on a beat (0.5 s grid); settle first so the envelope is warm.
    run(demo, 19_000, 20_030);
    const onBeat = kickLevel(demo);
    run(demo, 20_030 + FRAME_MS, 20_450);
    const beforeNext = kickLevel(demo);
    expect(onBeat).toBeGreaterThan(beforeNext + 0.1);
  });

  it('lets responsiveness shape the decay, like on real playback', () => {
    const smooth = createDemoSpectrum();
    const snappy = createDemoSpectrum();
    run(smooth, 19_000, 20_150, { fps: 60, responsiveness: 0 });
    run(snappy, 19_000, 20_150, { fps: 60, responsiveness: 1 });
    // 150 ms after the kick the snappy envelope has let go, the smooth one not.
    expect(kickLevel(smooth)).toBeGreaterThan(kickLevel(snappy) + 0.05);
  });

  it('produces new analysis no faster than the configured frame rate', () => {
    const demo = createDemoSpectrum();
    sampleDemoSpectrum(demo, 3_000, { fps: 30, responsiveness: 0.65 });
    const first = [...demo.frame.bands];

    sampleDemoSpectrum(demo, 3_020, { fps: 30, responsiveness: 0.65 });
    expect([...demo.frame.bands]).toEqual(first);

    sampleDemoSpectrum(demo, 3_040, { fps: 30, responsiveness: 0.65 });
    expect([...demo.frame.bands]).not.toEqual(first);
  });

  it('drops into a quiet break every eighth bar, for sensitivity to lift', () => {
    const meanBand = (demo: DemoSpectrum): number =>
      demo.frame.bands.reduce((sum, v) => sum + v, 0) / demo.frame.bands.length;
    const loud = createDemoSpectrum();
    const quiet = createDemoSpectrum();
    // Bars are 2 s long; bar 7 of each 8-bar cycle (14–16 s) is the break.
    run(loud, 12_000, 13_000);
    run(quiet, 14_000, 15_000);

    expect(meanBand(quiet)).toBeLessThan(meanBand(loud) - 0.15);
    expect(quiet.frame.rms).toBeLessThan(loud.frame.rms / 2);
  });

  it('gives the stereo mode two different channels', () => {
    const demo = createDemoSpectrum();
    run(demo, 7_000, 7_200);
    expect([...demo.frame.waveformLeft]).not.toEqual([...demo.frame.waveformRight]);
  });
});
