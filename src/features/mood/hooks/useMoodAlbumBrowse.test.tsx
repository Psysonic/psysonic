import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { latestIntersectionObserver } from '@/test/mocks/browser';

const hoisted = vi.hoisted(() => ({
  fetchMoodAlbumPage: vi.fn(),
  useLibraryScopeSyncRevision: vi.fn(() => 0),
}));

vi.mock('@/lib/library/moodAlbumBrowse', () => ({
  fetchMoodAlbumPage: hoisted.fetchMoodAlbumPage,
  MOOD_ALBUM_CATALOG_CHUNK: 200,
  MOOD_ALBUM_FIRST_PAGE: 60,
}));

vi.mock('@/store/offlineLocalLibrarySyncRevision', () => ({
  useLibraryScopeSyncRevision:
    hoisted.useLibraryScopeSyncRevision,
}));

import { useMoodAlbumBrowse } from './useMoodAlbumBrowse';

const browseScope = {
  anchorServerId: 'srv-1',
  serverIds: ['srv-1', 'srv-2'],
  pairs: [
    { serverId: 'srv-1', libraryId: null },
    { serverId: 'srv-2', libraryId: null },
  ],
  fingerprint: 'scope',
  multiServer: true,
};

function albums(offset: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `album-${offset + index}`,
    name: `Album ${offset + index}`,
    artist: 'Artist',
    artistId: 'artist-1',
    songCount: 1,
    duration: 60,
  }));
}

describe('useMoodAlbumBrowse', () => {
  beforeEach(() => {
    hoisted.fetchMoodAlbumPage.mockReset();
    hoisted.useLibraryScopeSyncRevision.mockReset();
    hoisted.useLibraryScopeSyncRevision.mockReturnValue(0);
  });

  it('continues draining pages while the sentinel stays intersecting', async () => {
    hoisted.fetchMoodAlbumPage
      .mockResolvedValueOnce({
        albums: albums(0, 60),
        hasMore: true,
      })
      .mockResolvedValueOnce({
        albums: albums(60, 200),
        hasMore: false,
      });

    const scrollRoot = document.createElement('div');

    const { result } = renderHook(() =>
      useMoodAlbumBrowse(
        'srv-1',
        'Atmospheric',
        true,
        'alphabeticalByName',
        0,
        browseScope,
        () => scrollRoot,
        scrollRoot,
      ),
    );

    await waitFor(() =>
      expect(result.current.displayAlbums).toHaveLength(60),
    );

    act(() => {
      result.current.bindLoadMoreSentinel(
        document.createElement('div'),
      );

      latestIntersectionObserver()?.emit(true);
    });

    await waitFor(() =>
      expect(
        hoisted.fetchMoodAlbumPage,
      ).toHaveBeenCalledTimes(2),
    );

    await waitFor(() =>
      expect(
        result.current.displayAlbums.length,
      ).toBeGreaterThan(60),
    );

    expect(
      hoisted.fetchMoodAlbumPage,
    ).toHaveBeenLastCalledWith(
      'srv-1',
      'Atmospheric',
      true,
      60,
      200,
      'alphabeticalByName',
      browseScope,
    );
  });

  it('reuses a loaded album session after remounting the same mood', async () => {
    hoisted.fetchMoodAlbumPage.mockResolvedValueOnce({
      albums: albums(0, 100),
      hasMore: true,
    });

    const first = renderHook(() =>
      useMoodAlbumBrowse(
        'srv-1',
        'Detail Round Trip Cache',
        true,
        'alphabeticalByName',
        17,
        browseScope,
      ),
    );

    await waitFor(() =>
      expect(first.result.current.displayAlbums).toHaveLength(60),
    );
    await waitFor(() =>
      expect(first.result.current.sessionReady).toBe(true),
    );

    first.unmount();

    const second = renderHook(() =>
      useMoodAlbumBrowse(
        'srv-1',
        'Detail Round Trip Cache',
        true,
        'alphabeticalByName',
        17,
        browseScope,
      ),
    );

    expect(second.result.current.displayAlbums).toHaveLength(60);
    expect(second.result.current.sessionReady).toBe(true);
    expect(second.result.current.loading).toBe(false);

    await waitFor(() =>
      expect(hoisted.fetchMoodAlbumPage).toHaveBeenCalledTimes(1),
    );
  });

  it('invalidates the cached album session after a library sync', async () => {
    hoisted.fetchMoodAlbumPage
      .mockResolvedValueOnce({
        albums: albums(0, 2),
        hasMore: false,
      })
      .mockResolvedValueOnce({
        albums: albums(0, 3),
        hasMore: false,
      });

    const first = renderHook(() =>
      useMoodAlbumBrowse(
        'srv-1',
        'Album Sync Cache',
        true,
        'alphabeticalByName',
        18,
        browseScope,
      ),
    );

    await waitFor(() =>
      expect(first.result.current.albums).toHaveLength(2),
    );

    first.unmount();
    hoisted.useLibraryScopeSyncRevision.mockReturnValue(1);

    const second = renderHook(() =>
      useMoodAlbumBrowse(
        'srv-1',
        'Album Sync Cache',
        true,
        'alphabeticalByName',
        18,
        browseScope,
      ),
    );

    await waitFor(() =>
      expect(second.result.current.albums).toHaveLength(3),
    );
    expect(hoisted.fetchMoodAlbumPage).toHaveBeenCalledTimes(2);
  });

  it('restores the prior displayed album count', async () => {
    hoisted.fetchMoodAlbumPage.mockResolvedValueOnce({
      albums: albums(0, 120),
      hasMore: true,
    });

    const scrollRoot =
      document.createElement('div');

    const { result } = renderHook(() =>
      useMoodAlbumBrowse(
        'srv-1',
        'Dreamy',
        true,
        'alphabeticalByName',
        0,
        browseScope,
        () => scrollRoot,
        scrollRoot,
        120,
      ),
    );

    await waitFor(() =>
      expect(
        result.current.displayAlbums,
      ).toHaveLength(120),
    );
    expect(result.current.sessionReady).toBe(true);

    expect(
      hoisted.fetchMoodAlbumPage,
    ).toHaveBeenCalledWith(
      'srv-1',
      'Dreamy',
      true,
      0,
      120,
      'alphabeticalByName',
      browseScope,
    );
  });
});