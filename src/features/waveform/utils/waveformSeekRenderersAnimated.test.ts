import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FULL_WAVE_LENGTH_PX,
  FULL_WAVE_PERIOD_S,
  fullWaveOffset,
} from '@/features/waveform/utils/waveformSeekRenderersAnimated';
import { drawSeekbar } from '@/features/waveform/utils/waveformSeekRenderers';
import { ANIMATED_STYLES, makeAnimState } from '@/features/waveform/utils/waveformSeekHelpers';

type Point = [number, number];

/** Canvas whose 2D context records every stroked path and filled rect. */
function recordingCanvas(width: number, height: number) {
  const strokes: Point[][] = [];
  const rects: Array<{ x: number; y: number; w: number; h: number }> = [];
  let path: Point[] = [];
  const ctx = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: () => { path = []; },
    moveTo: (x: number, y: number) => { path.push([x, y]); },
    lineTo: (x: number, y: number) => { path.push([x, y]); },
    stroke: () => { strokes.push(path); },
    fillRect: (x: number, y: number, w: number, h: number) => { rects.push({ x, y, w, h }); },
  } as unknown as CanvasRenderingContext2D;
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: width });
  Object.defineProperty(canvas, 'clientHeight', { value: height });
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx as never);
  return { canvas, strokes, rects };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fullWaveOffset', () => {
  it('starts flat at the track start and never leaves the amplitude', () => {
    expect(Math.abs(fullWaveOffset(0, 0.7, 4))).toBe(0);
    for (let x = 0; x < 400; x += 0.5) {
      expect(Math.abs(fullWaveOffset(x, 1.3, 4))).toBeLessThanOrEqual(4);
    }
  });

  it('reaches the full amplitude once past the fade-in', () => {
    const peak = Math.max(...Array.from({ length: 200 }, (_, i) => Math.abs(fullWaveOffset(20 + i * 0.25, 0, 4))));
    expect(peak).toBeGreaterThan(3.95);
  });

  it('drifts one wave length per period, towards the playhead', () => {
    const x = 100;
    // A quarter period later, the same shape sits a quarter wave length further right.
    expect(fullWaveOffset(x + FULL_WAVE_LENGTH_PX / 4, FULL_WAVE_PERIOD_S / 4, 4))
      .toBeCloseTo(fullWaveOffset(x, 0, 4), 6);
    expect(fullWaveOffset(x, FULL_WAVE_PERIOD_S, 4)).toBeCloseTo(fullWaveOffset(x, 0, 4), 6);
  });

  it('moves slowly: one wave takes at least two seconds', () => {
    expect(FULL_WAVE_PERIOD_S).toBeGreaterThanOrEqual(2);
  });
});

describe('drawSeekbar — fullwave', () => {
  it('is animated', () => {
    expect(ANIMATED_STYLES.has('fullwave')).toBe(true);
  });

  it('draws the wave over the whole played part and keeps the rest flat', () => {
    const { canvas, strokes, rects } = recordingCanvas(400, 20);
    const anim = makeAnimState();
    anim.time = 0.4;

    drawSeekbar(canvas, 'fullwave', null, 0.5, 0.7, anim);

    const wave = strokes[0];
    const xs = wave.map(([x]) => x);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(200);
    // Wavy, not a flat line
    const ys = wave.map(([, y]) => y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(4);
    // The flat rest line starts at the playhead, not at the track start
    expect(rects.some(r => r.x === 200 && r.w === 200)).toBe(true);
    expect(rects.some(r => r.x === 0)).toBe(false);
    // Playhead tick: vertical stroke at the playhead
    const tick = strokes[1];
    expect(tick.every(([x]) => x === 200)).toBe(true);
  });

  it('draws only the flat track before playback starts', () => {
    const { canvas, strokes, rects } = recordingCanvas(400, 20);
    drawSeekbar(canvas, 'fullwave', null, 0, 0, makeAnimState());
    expect(strokes).toHaveLength(0);
    expect(rects.some(r => r.x === 0 && r.w === 400)).toBe(true);
  });
});
