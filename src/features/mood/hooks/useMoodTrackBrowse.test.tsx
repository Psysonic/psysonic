import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  fetchMoodTrackPage: vi.fn(),
}));

vi.mock('@/lib/library/moodTrackBrowse', () => ({
  fetchMoodTrackPage: hoisted.fetchMoodTrackPage,
  MOOD_TRACK_PAGE_SIZE: 100,
}));

import { useMoodTrackBrowse } from './useMoodTrackBrowse';

const browseScope = {
  anchorServerId: 'srv-1',
  serverIds: ['srv-1'],
  pairs: [{ serverId: 'srv-1', libraryId: null }],
  fingerprint: 'scope',
  multiServer: false,
};

function songs(offset: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `track-${offset + index}`,
    title: `Track ${offset + index}`,
    artist: 'Artist',
    album: 'Album',
    albumId: 'album-1',
    duration: 180,
  }));
}

describe('useMoodTrackBrowse', () => {
  beforeEach(() => {
    hoisted.fetchMoodTrackPage.mockReset();
  });

  it('does not load tracks until the view is enabled', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useMoodTrackBrowse(
          'srv-1',
          'Dreamy',
          true,
          enabled,
          0,
          browseScope,
        ),
      {
        initialProps: { enabled: false },
      },
    );

    expect(hoisted.fetchMoodTrackPage).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);

    hoisted.fetchMoodTrackPage.mockResolvedValueOnce({
      songs: songs(0, 2),
      hasMore: false,
      total: 2,
    });

    rerender({ enabled: true });

    await waitFor(() =>
      expect(hoisted.fetchMoodTrackPage).toHaveBeenCalledTimes(1),
    );

    expect(hoisted.fetchMoodTrackPage).toHaveBeenCalledWith(
      'srv-1',
      'Dreamy',
      true,
      0,
      100,
      browseScope,
      true,
    );

    await waitFor(() =>
      expect(result.current.total).toBe(2),
    );
  });

  it('starts in loading state when the Tracks view mounts active', () => {
    hoisted.fetchMoodTrackPage.mockReturnValue(
      new Promise(() => {}),
    );

    const { result } = renderHook(() =>
      useMoodTrackBrowse(
        'srv-1',
        'Dreamy',
        true,
        true,
        1,
        browseScope,
      ),
    );

    expect(result.current.loading).toBe(true);
  });

  it('reuses the loaded track session after remounting the same mood', async () => {
    hoisted.fetchMoodTrackPage.mockResolvedValueOnce({
      songs: songs(0, 100),
      hasMore: true,
      total: 347,
    });

    const first = renderHook(() =>
      useMoodTrackBrowse(
        'srv-1',
        'Cache Test',
        true,
        true,
        7,
        browseScope,
      ),
    );

    await waitFor(() =>
      expect(first.result.current.songs).toHaveLength(100),
    );

    first.unmount();

    const second = renderHook(() =>
      useMoodTrackBrowse(
        'srv-1',
        'Cache Test',
        true,
        true,
        7,
        browseScope,
      ),
    );

    expect(second.result.current.songs).toHaveLength(100);
    expect(second.result.current.total).toBe(347);
    expect(second.result.current.loading).toBe(false);

    await waitFor(() =>
      expect(hoisted.fetchMoodTrackPage).toHaveBeenCalledTimes(1),
    );
  });

  it('appends the next page and deduplicates track ids', async () => {
    hoisted.fetchMoodTrackPage
      .mockResolvedValueOnce({
        songs: songs(0, 100),
        hasMore: true,
        total: 102,
      })
      .mockResolvedValueOnce({
        songs: [
          songs(99, 1)[0],
          ...songs(100, 2),
        ],
        hasMore: false,
        total: null,
      });

    const { result } = renderHook(() =>
      useMoodTrackBrowse(
        'srv-1',
        'Atmospheric',
        true,
        true,
        0,
        browseScope,
      ),
    );

    await waitFor(() =>
      expect(result.current.songs).toHaveLength(100),
    );

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() =>
      expect(result.current.songs).toHaveLength(102),
    );

    expect(result.current.hasMore).toBe(false);
    expect(result.current.total).toBe(102);
    expect(hoisted.fetchMoodTrackPage).toHaveBeenLastCalledWith(
      'srv-1',
      'Atmospheric',
      true,
      100,
      100,
      browseScope,
      false,
    );
  });
});
