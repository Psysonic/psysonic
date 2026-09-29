/**
 * useBurnTiming — whose clock it is.
 *
 * The burner page can be left and returned to while a burn runs: the job store
 * and the event bridge are app-wide, the page is not. A clock started on mount
 * therefore counts from the moment the user came back, which is how a
 * two-and-a-half minute rehearsal came to report four seconds.
 */
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBurnTiming } from '@/features/burner/hooks/useBurnTiming';

describe('useBurnTiming', () => {
  it('counts from when the laser started, not from when the page mounted', () => {
    // Coming back to the page mid-burn: the store knows the write began two and
    // a half minutes ago, and this mount is the first the hook has seen of it.
    const { result } = renderHook(() =>
      useBurnTiming({
        writing: true,
        sectorsDone: 50_000,
        sectorsTotal: 100_000,
        writeStartedAt: Date.now() - 150_000,
      }),
    );

    expect(result.current.elapsedSec).toBeGreaterThan(149);
    expect(result.current.elapsedSec).toBeLessThan(152);
  });

  it('counts from now when the write began this instant', () => {
    const { result } = renderHook(() =>
      useBurnTiming({
        writing: true,
        sectorsDone: 0,
        sectorsTotal: 100_000,
        writeStartedAt: Date.now(),
      }),
    );

    expect(result.current.elapsedSec).toBeGreaterThanOrEqual(0);
    expect(result.current.elapsedSec).toBeLessThan(2);
  });

  it('says nothing before the laser starts', () => {
    const { result } = renderHook(() =>
      useBurnTiming({
        writing: false,
        sectorsDone: 0,
        sectorsTotal: 100_000,
        writeStartedAt: null,
      }),
    );

    expect(result.current.elapsedSec).toBeNull();
    expect(result.current.remainingSec).toBeNull();
    expect(result.current.sectorsPerSec).toBeNull();
  });

  it('still runs a clock when the store has no start to offer', () => {
    // Defensive: a progress event the store never saw would leave this null,
    // and a burn in front of the user must still be timed from somewhere.
    const { result } = renderHook(() =>
      useBurnTiming({
        writing: true,
        sectorsDone: 10,
        sectorsTotal: 100_000,
        writeStartedAt: null,
      }),
    );

    expect(result.current.elapsedSec).not.toBeNull();
    expect(result.current.elapsedSec).toBeLessThan(2);
  });
});
