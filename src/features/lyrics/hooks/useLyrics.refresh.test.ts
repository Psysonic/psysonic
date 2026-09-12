import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/lib/media/trackTypes';
import type { CachedLyrics } from '@/features/lyrics/types';
import { useAuthStore } from '@/store/authStore';
import { lyricsCache, useLyrics } from '@/features/lyrics/hooks/useLyrics';
import { lyricsCacheKey } from '@/features/lyrics/utils/lyricsPersistentCache';

// The persistent layer is backed by a real Map here, not by resolved values:
// the point of the refresh action is that the L2 entry is actually gone, so a
// mock that always reports a miss on the second read would pass even if the
// delete never happened (issue #1506).
const mocks = vi.hoisted(() => ({
  getLyricsSelectionBySongId: vi.fn(),
  store: new Map<string, unknown>(),
}));

vi.mock('@/lib/api/subsonicLyrics', () => ({
  getLyricsSelectionBySongId: mocks.getLyricsSelectionBySongId,
}));
vi.mock('@/features/lyrics/utils/lyricsPersistentCache', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/lyrics/utils/lyricsPersistentCache')>();
  return {
    ...actual,
    getCachedLyrics: vi.fn(async (key: string) => (mocks.store.get(key) ?? null) as CachedLyrics | null),
    putCachedLyrics: vi.fn(async (key: string, payload: CachedLyrics) => { mocks.store.set(key, payload); }),
    deleteCachedLyrics: vi.fn(async (key: string) => { mocks.store.delete(key); }),
  };
});

const track: Track = {
  id: 'song-1',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  albumId: 'album-1',
  duration: 120,
  serverId: 'srv-1',
};

const CACHE_KEY = lyricsCacheKey('srv-1', 'song-1');

const staleEntry: CachedLyrics = {
  syncedLines: null,
  wordLines: null,
  plainLyrics: 'Stale cached lyrics',
  source: 'server',
  notFound: false,
};

beforeEach(() => {
  lyricsCache.clear();
  mocks.store.clear();
  mocks.getLyricsSelectionBySongId.mockReset();
  useAuthStore.setState({
    activeServerId: 'srv-1',
    servers: [],
    lyricsSources: [
      { id: 'server', enabled: true },
      { id: 'lrclib', enabled: false },
      { id: 'netease', enabled: false },
    ],
  });
});

describe('useLyrics refresh', () => {
  it('drops both cache levels and refetches lyrics edited server-side', async () => {
    mocks.store.set(CACHE_KEY, staleEntry);

    const { result } = renderHook(() => useLyrics(track));

    // The persisted copy is served without asking the server at all — this is
    // the state a user is stuck in for the full TTL after editing the lyrics.
    await waitFor(() => expect(result.current.plainLyrics).toBe('Stale cached lyrics'));
    expect(mocks.getLyricsSelectionBySongId).not.toHaveBeenCalled();
    expect(lyricsCache.has(CACHE_KEY)).toBe(true);

    mocks.getLyricsSelectionBySongId.mockResolvedValue({
      main: {
        line: [{ start: 0, value: 'Fresh server lyrics' }],
        synced: false,
      },
      pronunciation: null,
    });

    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.plainLyrics).toBe('Fresh server lyrics'));
    expect(mocks.getLyricsSelectionBySongId).toHaveBeenCalledWith('song-1', { enhanced: false, serverId: 'srv-1' });
    // Refetched content replaces the persisted copy rather than leaving a hole.
    expect(mocks.store.get(CACHE_KEY)).toMatchObject({ plainLyrics: 'Fresh server lyrics' });
  });

  it('refetches after a not-found result so later-added lyrics are picked up', async () => {
    mocks.store.set(CACHE_KEY, {
      syncedLines: null,
      wordLines: null,
      plainLyrics: null,
      source: null,
      notFound: true,
    });

    const { result } = renderHook(() => useLyrics(track));
    await waitFor(() => expect(result.current.notFound).toBe(true));

    mocks.getLyricsSelectionBySongId.mockResolvedValue({
      main: {
        line: [{ start: 0, value: 'Added later' }],
        synced: false,
      },
      pronunciation: null,
    });

    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.plainLyrics).toBe('Added later'));
    expect(result.current.notFound).toBe(false);
  });
});
