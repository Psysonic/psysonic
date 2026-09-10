/**
 * Live timing for the write phase.
 *
 * Samples the sector counter as progress events land and measures the rate
 * from them. Nothing is estimated before the laser starts — see `burnTiming`
 * for why a speed cannot be asked for honestly up front.
 */
import { useEffect, useRef, useState } from 'react';
import {
  burnTiming,
  trimSamples,
  type BurnSample,
  type BurnTiming,
} from '@/features/burner/utils/burnTiming';

/** How often the clock re-renders while writing. */
const TICK_MS = 500;

const IDLE: BurnTiming = {
  elapsedSec: null,
  remainingSec: null,
  totalSec: null,
  sectorsPerSec: null,
  history: [],
};

/**
 * Rate samples kept for the trace, at one every TICK_MS.
 *
 * Half a minute of writing. Long enough to show a drive dropping a gear,
 * short enough that the shape still moves while you watch it.
 */
const HISTORY_MAX = 60;

export function useBurnTiming(args: {
  /** True only while the laser is on. */
  writing: boolean;
  sectorsDone: number;
  sectorsTotal: number;
}): BurnTiming {
  const { writing, sectorsDone, sectorsTotal } = args;

  const samples = useRef<BurnSample[]>([]);
  const startedAt = useRef<number | null>(null);
  const history = useRef<number[]>([]);
  const [timing, setTiming] = useState<BurnTiming>(IDLE);

  // Record every distinct sector count. Kept in a ref rather than state: a
  // sample is not something to render, only something to measure from.
  useEffect(() => {
    if (!writing) {
      samples.current = [];
      startedAt.current = null;
      history.current = [];
      return;
    }
    const now = performance.now();
    startedAt.current ??= now;
    const last = samples.current[samples.current.length - 1];
    if (!last || last.sectorsDone !== sectorsDone) {
      samples.current = trimSamples([...samples.current, { at: now, sectorsDone }], now);
    }
  }, [writing, sectorsDone]);

  // The clock has to move between progress events, which arrive every 250ms at
  // best and far less often on a slow drive.
  useEffect(() => {
    if (!writing) {
      // React Compiler set-state-in-effect rule: the clock is cleared because
      // the laser stopped, which is an external event, not something derivable
      // from props during render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTiming(IDLE);
      return;
    }
    const tick = () => {
      // Trimmed here rather than only where samples arrive. The sampling
      // effect fires on a new sector count, so a drive that stalls or reports
      // slowly stops trimming altogether, and the rate then comes from a
      // window that has quietly aged well past WINDOW_MS.
      const now = performance.now();
      samples.current = trimSamples(samples.current, now);
      const next = burnTiming(samples.current, sectorsTotal, now, startedAt.current);
      // The trace wants the rate as it was, not as it ends up. Recorded here
      // rather than inside `burnTiming`, which is pure and has no memory.
      if (next.sectorsPerSec !== null) {
        history.current = [...history.current, next.sectorsPerSec].slice(-HISTORY_MAX);
      }
      setTiming({ ...next, history: history.current });
    };
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [writing, sectorsTotal]);

  return timing;
}
