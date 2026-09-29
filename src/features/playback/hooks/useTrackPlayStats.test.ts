import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePlayerStore } from '../store/playerStore';
import { useTrackPlayStats } from './useTrackPlayStats';

const LOADED = { id: 't1', serverId: 'srv', playCount: 3, played: '2026-09-01T10:00:00.000Z' };

beforeEach(() => {
  usePlayerStore.setState({ playStatsOverrides: {} });
});

describe('useTrackPlayStats', () => {
  it('reports what the row was loaded with until the track is played', () => {
    const { result } = renderHook(() => useTrackPlayStats(LOADED));
    expect(result.current).toEqual({ playCount: 3, played: '2026-09-01T10:00:00.000Z' });
  });

  it('updates a row that is already on screen when its track is played', () => {
    const { result } = renderHook(() => useTrackPlayStats(LOADED));

    act(() => {
      usePlayerStore.getState().setPlayStatsOverride('srv:t1', {
        played: '2026-09-10T12:00:00.000Z',
      });
    });
    expect(result.current.played).toBe('2026-09-10T12:00:00.000Z');
    // Still the loaded count: only the server can say what the new one is.
    expect(result.current.playCount).toBe(3);

    act(() => {
      usePlayerStore.getState().setPlayStatsOverride('srv:t1', { playCount: 4 });
    });
    expect(result.current).toEqual({ playCount: 4, played: '2026-09-10T12:00:00.000Z' });
  });

  it('leaves other rows alone', () => {
    const other = { id: 't2', serverId: 'srv', playCount: 9 };
    const { result } = renderHook(() => useTrackPlayStats(other));

    act(() => {
      usePlayerStore.getState().setPlayStatsOverride('srv:t1', { playCount: 4 });
    });
    expect(result.current.playCount).toBe(9);
  });
});
