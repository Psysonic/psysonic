import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedBuffering } from './useDebouncedBuffering';

describe('useDebouncedBuffering', () => {
  it('starts false when isBuffering is false', () => {
    const { result } = renderHook(() => useDebouncedBuffering(false));
    expect(result.current).toBe(false);
  });

  it('stays false when buffering pulse is shorter than delayMs', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ buffering }) => useDebouncedBuffering(buffering, 150),
      { initialProps: { buffering: false } },
    );

    rerender({ buffering: true });
    expect(result.current).toBe(false);

    // Advance 50 ms (seek finishes quickly in RAM)
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current).toBe(false);

    // Buffering ends
    rerender({ buffering: false });
    expect(result.current).toBe(false);

    // Even after delay passes, it never flashed true
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe(false);

    vi.useRealTimers();
  });

  it('turns true when buffering exceeds delayMs, and resets immediately when buffering ends', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ buffering }) => useDebouncedBuffering(buffering, 150),
      { initialProps: { buffering: false } },
    );

    rerender({ buffering: true });
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current).toBe(true);

    // Clears immediately
    rerender({ buffering: false });
    expect(result.current).toBe(false);

    vi.useRealTimers();
  });
});
