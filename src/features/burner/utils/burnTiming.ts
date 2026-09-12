/**
 * How long the burn has taken, and how much longer it will take.
 *
 * Measured, never guessed. A write speed cannot be asked for up front with any
 * honesty: "Automatic" means the drive decides, and the Linux backend does not
 * report speeds at all — so any figure shown before the laser starts would be
 * invented. Instead the rate comes from the sectors the drive actually reports,
 * which also means it tracks a drive that slows down over the disc, as most do.
 */

/** One observation of the write, taken from a progress event. */
export interface BurnSample {
  /** `performance.now()` when the event arrived. */
  at: number;
  sectorsDone: number;
}

export interface BurnTiming {
  /** Seconds since the laser started, or `null` before it did. */
  elapsedSec: number | null;
  /** Seconds left at the measured rate, or `null` while unknowable. */
  remainingSec: number | null;
  /** Elapsed + remaining, so the total settles as the estimate does. */
  totalSec: number | null;
  /** Sectors per second over the sampling window. */
  sectorsPerSec: number | null;
  /**
   * Recent rates, oldest first, for the trace.
   *
   * Filled by the hook rather than here: this function is pure and gets the
   * whole sample window on every call, so it has nowhere to keep a history.
   */
  history: number[];
}

/**
 * How much history to average over.
 *
 * Long enough that one slow event does not swing the estimate, short enough
 * that a drive changing speed is followed rather than averaged away.
 */
const WINDOW_MS = 12_000;

/** Below this the rate is noise and dividing by it produces absurd figures. */
const MIN_RATE_SECTORS_PER_SEC = 1;

/** Ignore the first moments: a drive's opening rate is not its real one. */
const SETTLE_MS = 1_500;

/** Drop samples that have aged out of the window. */
export function trimSamples(samples: BurnSample[], now: number): BurnSample[] {
  const cutoff = now - WINDOW_MS;
  const kept = samples.filter(sample => sample.at >= cutoff);
  // Always keep one sample behind the window, or a slow event stream leaves
  // nothing to measure against.
  if (kept.length < 2 && samples.length >= 2) return samples.slice(-2);
  return kept;
}

/**
 * Work out where the burn is.
 *
 * `startedAt` is when writing began. Everything is `null` until there are two
 * samples far enough apart to divide by, which is what stops "0:00 remaining"
 * flashing at the start.
 */
export function burnTiming(
  samples: BurnSample[],
  sectorsTotal: number,
  now: number,
  startedAt: number | null,
): BurnTiming {
  const elapsedSec = startedAt === null ? null : Math.max(0, (now - startedAt) / 1000);

  const first = samples[0];
  const last = samples[samples.length - 1];
  const span = first && last ? last.at - first.at : 0;

  if (!first || !last || span < SETTLE_MS || sectorsTotal <= 0) {
    return { elapsedSec, remainingSec: null, totalSec: null, sectorsPerSec: null, history: [] };
  }

  const sectors = last.sectorsDone - first.sectorsDone;
  const sectorsPerSec = sectors / (span / 1000);

  if (!Number.isFinite(sectorsPerSec) || sectorsPerSec < MIN_RATE_SECTORS_PER_SEC) {
    return { elapsedSec, remainingSec: null, totalSec: null, sectorsPerSec: null, history: [] };
  }

  const left = Math.max(0, sectorsTotal - last.sectorsDone);
  const remainingSec = left / sectorsPerSec;

  return {
    elapsedSec,
    remainingSec,
    // Elapsed plus remaining rather than total/rate: the two then always agree,
    // and the total settles as the estimate does instead of jumping about.
    totalSec: elapsedSec === null ? null : elapsedSec + remainingSec,
    sectorsPerSec,
    history: [],
  };
}

/** `m:ss`, or an em dash when there is nothing honest to show. */
export function formatClock(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}
