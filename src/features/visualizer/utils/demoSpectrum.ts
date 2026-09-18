/**
 * Synthetic signal for the settings preview, so the visualizer's controls can
 * be judged without anything playing.
 *
 * It imitates what the radio path reads from an `AnalyserNode` — linear FFT
 * bins over the -60..0 dB display range plus a time-domain window — and runs
 * through the same `applyAnalyserData` envelope. Responsiveness, peak caps and
 * the frame rate therefore act on it exactly as they act on real playback;
 * sensitivity is applied later by the renderer, as for every other source.
 *
 * The "track" is a four-chord loop at 120 BPM: a kick on every beat, a snare on
 * two and four, hi-hats on the eighths, a bass note and a pad, with a quiet
 * break every eighth bar. Pure module and deterministic in time.
 */
import {
  applyAnalyserData,
  createFrame,
  createSpectrumEnvelopeState,
  SPECTRUM_FLOOR_DB,
  type SpectrumEnvelopeState,
  type SpectrumFrame,
} from '@/features/visualizer/utils/spectrumFrame';
import type { SpectrumFeedParams } from '@/features/visualizer/utils/spectrumSubscription';

const SAMPLE_RATE = 48_000;
/** Same analyser shape as the radio graph (fftSize 2048). */
const BIN_COUNT = 1024;
const BIN_HZ = SAMPLE_RATE / (BIN_COUNT * 2);
const WINDOW_SECONDS = (BIN_COUNT * 2) / SAMPLE_RATE;
/** Time-domain points across one window; the display keeps 256 of them. */
const TRACE_POINTS = 512;
const TRACE_STEP = WINDOW_SECONDS / TRACE_POINTS;

const BEAT_SECONDS = 0.5;
const BAR_SECONDS = BEAT_SECONDS * 4;
const MINOR = [1, 1.1892, 1.4983];
const MAJOR = [1, 1.2599, 1.4983];
/** Bass roots of the loop, one chord per bar. */
const CHORDS = [
  { root: 110, triad: MINOR },
  { root: 87.31, triad: MAJOR },
  { root: 130.81, triad: MAJOR },
  { root: 98, triad: MAJOR },
];
/** Per-note stereo placement of the pad, so the stereo mode has two rings to draw. */
const PAD_LEFT = [1, 0.55, 0.85];
const PAD_RIGHT = [0.55, 1, 0.85];

export interface DemoSpectrum {
  frame: SpectrumFrame;
  envelope: SpectrumEnvelopeState;
  /** Scratch, reused every pull so sampling never allocates. */
  power: Float32Array;
  freqBytes: Uint8Array;
  timeBytes: Uint8Array;
  left: Float32Array;
  right: Float32Array;
  lastPull: number;
}

export function createDemoSpectrum(): DemoSpectrum {
  const frame = createFrame();
  return {
    frame,
    envelope: createSpectrumEnvelopeState(frame.bands.length),
    power: new Float32Array(BIN_COUNT),
    freqBytes: new Uint8Array(BIN_COUNT),
    timeBytes: new Uint8Array(TRACE_POINTS),
    left: new Float32Array(TRACE_POINTS),
    right: new Float32Array(TRACE_POINTS),
    lastPull: 0,
  };
}

/** Integer hash to 0..1 — cheap, stable noise that needs no RNG state. */
function hashUnit(n: number): number {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4_294_967_296;
}

function dbToPower(db: number): number {
  return Math.pow(10, db / 10);
}

/** Seconds since the most recent hit of a pattern repeating every `period`. */
function sinceHit(t: number, period: number, offset = 0): number {
  const x = t - offset;
  return x - Math.floor(x / period) * period;
}

function chordAt(t: number): (typeof CHORDS)[number] {
  const bar = Math.floor(t / BAR_SECONDS);
  return CHORDS[((bar % CHORDS.length) + CHORDS.length) % CHORDS.length]!;
}

/**
 * The last of every eight bars is a quiet break without drums, so the
 * sensitivity control has a soft passage to lift.
 */
function isBreak(t: number): boolean {
  const bar = Math.floor(t / BAR_SECONDS);
  return ((bar % 8) + 8) % 8 === 7;
}

const BREAK_GAIN_DB = -12;
const BREAK_TRACE_GAIN = Math.pow(10, BREAK_GAIN_DB / 20);

/** Add a spectral line of `peakDb` at `hz`, spread over a few neighbouring bins. */
function addLine(power: Float32Array, hz: number, peakDb: number, widthBins = 1.3): void {
  const centre = hz / BIN_HZ;
  const lo = Math.max(1, Math.floor(centre - widthBins * 4));
  const hi = Math.min(power.length - 1, Math.ceil(centre + widthBins * 4));
  const peak = dbToPower(peakDb);
  for (let k = lo; k <= hi; k++) {
    const d = (k - centre) / widthBins;
    power[k]! += peak * Math.exp(-0.5 * d * d);
  }
}

/**
 * Add a band of energy between two frequencies with a per-octave slope. Both
 * edges fade in over half an octave; a hard edge shows up as a step in the bars.
 */
function addBand(
  power: Float32Array,
  fromHz: number,
  toHz: number,
  levelDb: number,
  slopeDbPerOctave: number,
): void {
  const lo = Math.max(1, Math.floor(fromHz / BIN_HZ));
  const hi = Math.min(power.length - 1, Math.ceil(toHz / BIN_HZ));
  const span = Math.log2(toHz / fromHz);
  for (let k = lo; k <= hi; k++) {
    const octaves = Math.log2((k * BIN_HZ) / fromHz);
    const edge = Math.min(1, Math.max(0, Math.min(octaves, span - octaves) / 0.5));
    power[k]! += edge * dbToPower(levelDb + slopeDbPerOctave * octaves);
  }
}

function envelopeDb(amount: number): number {
  return amount > 1e-6 ? 20 * Math.log10(amount) : -120;
}

function fillSpectrum(demo: DemoSpectrum, t: number): void {
  const { power, freqBytes } = demo;
  const tick = Math.floor(t * 60);
  const quiet = isBreak(t);
  // A slow swell across the loop, plus the break's drop.
  const mixDb = 2 * Math.sin((2 * Math.PI * t) / 4) + (quiet ? BREAK_GAIN_DB : 0);

  // Levels are chosen for the display, which adds up to +18 dB of tilt towards
  // the treble: a mix of roughly -6 dB per octave then reads as a gentle slope.
  for (let k = 0; k < power.length; k++) {
    const hz = Math.max(BIN_HZ, k * BIN_HZ);
    const body = hz < 150
      ? -26 - 6 * Math.log2(150 / hz)
      : -26 - 6 * Math.log2(hz / 150);
    const floor = -63 + (hashUnit(k * 131 + tick * 7_919) - 0.5) * 6;
    power[k] = dbToPower(body + mixDb) + dbToPower(floor);
  }

  const chord = chordAt(t);
  addLine(power, chord.root, -13 + mixDb);
  addLine(power, chord.root * 2, -19 + mixDb);
  for (let note = 0; note < chord.triad.length; note++) {
    const hz = chord.root * 2 * chord.triad[note]!;
    const shimmer = 2 * Math.sin(2 * Math.PI * (t / 3 + note / 3));
    for (let h = 1; h <= 6; h++) addLine(power, hz * h, -21 - 5 * (h - 1) + shimmer + mixDb);
  }

  if (!quiet) addDrums(power, t);

  const range = -SPECTRUM_FLOOR_DB;
  for (let k = 0; k < power.length; k++) {
    const db = 10 * Math.log10(Math.max(power[k]!, 1e-12));
    const byte = Math.round(((db - SPECTRUM_FLOOR_DB) / range) * 255);
    freqBytes[k] = byte < 0 ? 0 : byte > 255 ? 255 : byte;
  }
}

function addDrums(power: Float32Array, t: number): void {
  const kick = Math.exp(-sinceHit(t, BEAT_SECONDS) / 0.12);
  addLine(power, 58, -5 + envelopeDb(kick), 1.6);
  addBand(power, 1_000, 5_000, -36 + envelopeDb(Math.exp(-sinceHit(t, BEAT_SECONDS) / 0.015)), -3);

  const snare = Math.exp(-sinceHit(t, BEAT_SECONDS * 2, BEAT_SECONDS) / 0.1);
  addLine(power, 200, -15 + envelopeDb(snare), 2);
  addBand(power, 800, 9_000, -26 + envelopeDb(snare), -3);

  const hat = Math.exp(-sinceHit(t, BEAT_SECONDS / 2) / 0.04);
  addBand(power, 6_000, 16_000, -36 + envelopeDb(hat), -2);
}

function fillTraces(demo: DemoSpectrum, t: number): void {
  const { left, right, timeBytes } = demo;
  for (let i = 0; i < TRACE_POINTS; i++) {
    const at = t - (TRACE_POINTS - 1 - i) * TRACE_STEP;
    const chord = chordAt(at);
    const bass = 0.3 * Math.sin(2 * Math.PI * chord.root * at);

    let padL = 0;
    let padR = 0;
    for (let note = 0; note < chord.triad.length; note++) {
      const v = 0.08 * Math.sin(2 * Math.PI * chord.root * 2 * chord.triad[note]! * at + note);
      padL += v * PAD_LEFT[note]!;
      padR += v * PAD_RIGHT[note]!;
    }

    // Pitch-dropping sine, integrated so the phase stays continuous.
    const sinceKick = sinceHit(at, BEAT_SECONDS);
    const kickPhase = 2 * Math.PI * (45 * sinceKick + 1.35 * (1 - Math.exp(-sinceKick / 0.03)));
    const kick = 0.55 * Math.exp(-sinceKick / 0.12) * Math.sin(kickPhase);

    const sample = Math.round(at * 12_000);
    const snare = 0.22 * Math.exp(-sinceHit(at, BEAT_SECONDS * 2, BEAT_SECONDS) / 0.1)
      * (hashUnit(sample) * 2 - 1);
    const hat = 0.06 * Math.exp(-sinceHit(at, BEAT_SECONDS / 2) / 0.04)
      * (hashUnit(sample + 7_919) * 2 - 1);

    const quiet = isBreak(at);
    const gain = quiet ? BREAK_TRACE_GAIN : 1;
    const drums = quiet ? 0 : 1;
    const centre = gain * bass + drums * (kick + snare);
    left[i] = Math.tanh(1.2 * (centre + gain * padL + drums * hat * 0.5));
    right[i] = Math.tanh(1.2 * (centre + gain * padR + drums * hat));
    const mono = (left[i]! + right[i]!) / 2;
    timeBytes[i] = Math.max(0, Math.min(255, Math.round(128 + mono * 127)));
  }
}

/** Keep the sample of largest magnitude per bucket, like `downsampleWaveform`. */
function downsample(target: Float32Array, source: Float32Array): void {
  const bucket = source.length / target.length;
  for (let i = 0; i < target.length; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucket));
    let extreme = 0;
    for (let j = start; j < Math.min(end, source.length); j++) {
      const v = source[j]!;
      if (Math.abs(v) > Math.abs(extreme)) extreme = v;
    }
    target[i] = extreme;
  }
}

/**
 * Advance the demo to `now` (ms). New analysis is produced at most `params.fps`
 * times a second, like the radio feed; in between the frame is left as is.
 */
export function sampleDemoSpectrum(
  demo: DemoSpectrum,
  now: number,
  params: SpectrumFeedParams,
): void {
  const fps = Math.max(1, params.fps);
  if (demo.lastPull > 0 && now - demo.lastPull < 1_000 / fps) return;
  const dt = demo.lastPull > 0 ? (now - demo.lastPull) / 1_000 : 1 / fps;
  demo.lastPull = now;

  const t = now / 1_000;
  fillSpectrum(demo, t);
  fillTraces(demo, t);
  applyAnalyserData(
    demo.frame,
    demo.freqBytes,
    demo.timeBytes,
    SAMPLE_RATE,
    dt,
    params.responsiveness,
    demo.envelope,
  );
  // One analyser has no channel separation; the demo does, so the stereo mode
  // gets its own two traces instead of the mono copy.
  downsample(demo.frame.waveformLeft, demo.left);
  downsample(demo.frame.waveformRight, demo.right);
}
