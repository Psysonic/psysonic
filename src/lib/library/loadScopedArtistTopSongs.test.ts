import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryTrackDto } from '@/lib/api/library/dto';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';

const { getTopSongsForServerMock, libraryGetTracksBatchMock } = vi.hoisted(() => ({
  getTopSongsForServerMock: vi.fn(),
  libraryGetTracksBatchMock: vi.fn(),
}));

vi.mock('@/lib/api/subsonicArtists', () => ({
  getTopSongsForServer: (...args: unknown[]) => getTopSongsForServerMock(...args),
}));

vi.mock('@/lib/api/library/reads', () => ({
  libraryGetTracksBatch: (...args: unknown[]) => libraryGetTracksBatchMock(...args),
}));

import { loadScopedArtistTopSongs } from './loadScopedArtistTopSongs';

function song(id: string, title: string, album = 'Album'): SubsonicSong {
  return { id, title, album, albumId: `${album}-id`, artist: 'Artist', duration: 180 };
}

function indexedTrack(id: string, libraryId: string): LibraryTrackDto {
  return {
    serverId: 'srv-2', id, title: id, album: 'Album', durationSec: 180,
    libraryId, syncedAt: 0, rawJson: {},
  };
}

describe('loadScopedArtistTopSongs', () => {
  beforeEach(() => {
    getTopSongsForServerMock.mockReset();
    libraryGetTracksBatchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queries only the broadest server, preserves global rank, and filters to scope', async () => {
    getTopSongsForServerMock.mockResolvedValue([
      song('global-2', 'Second'),
      song('outside', 'Outside'),
      song('global-1', 'First'),
    ]);
    libraryGetTracksBatchMock.mockResolvedValue([
      indexedTrack('global-2', 'lib-b'),
      indexedTrack('outside', 'lib-x'),
      indexedTrack('global-1', 'lib-b'),
    ]);

    const result = await loadScopedArtistTopSongs({
      artistName: 'Unique Artist One',
      sourceServerId: 'srv-2',
      scopes: [
        { serverId: 'srv-1', libraryId: 'lib-a' },
        { serverId: 'srv-2', libraryId: 'lib-b' },
      ],
      localFallback: [
        song('fallback-duplicate', 'First'),
        song('fallback-local', 'Local Favourite'),
      ],
      tracksFingerprint: 'tracks-1',
    });

    expect(getTopSongsForServerMock).toHaveBeenCalledOnce();
    expect(getTopSongsForServerMock).toHaveBeenCalledWith('srv-2', 'Unique Artist One', {
      requestCount: 20,
      limit: 20,
      timeout: 5000,
      libraryIds: ['lib-b'],
      filterToLibrary: false,
    });
    expect(result.map(track => track.id)).toEqual(['global-2', 'global-1', 'fallback-local']);
    expect(result[0]?.serverId).toBe('srv-2');
  });

  it('queries the whole server without a folder filter when all libraries are selected', async () => {
    getTopSongsForServerMock.mockResolvedValue([
      song('global-2', 'Second'),
      song('not-indexed', 'Not Indexed'),
      song('global-1', 'First'),
    ]);
    libraryGetTracksBatchMock.mockResolvedValue([
      indexedTrack('global-2', 'lib-b'),
      indexedTrack('global-1', 'lib-c'),
    ]);

    const result = await loadScopedArtistTopSongs({
      artistName: 'Unique Artist Whole Server',
      sourceServerId: 'srv-2',
      scopes: [
        { serverId: 'srv-1', libraryId: 'lib-a' },
        { serverId: 'srv-2', libraryId: null },
      ],
      localFallback: [song('fallback-local', 'Local Favourite')],
      tracksFingerprint: 'tracks-whole-server',
    });

    expect(getTopSongsForServerMock).toHaveBeenCalledWith('srv-2', 'Unique Artist Whole Server', {
      requestCount: 20,
      limit: 20,
      timeout: 5000,
      libraryIds: [],
      filterToLibrary: false,
    });
    expect(result.map(track => track.id)).toEqual(['global-2', 'global-1', 'fallback-local']);
  });

  it('uses the bounded local fallback when the chosen server fails', async () => {
    getTopSongsForServerMock.mockRejectedValue(new Error('offline'));

    const fallback = Array.from({ length: 7 }, (_, index) => song(`local-${index}`, `Local ${index}`));
    const result = await loadScopedArtistTopSongs({
      artistName: 'Unique Artist Two',
      sourceServerId: 'srv-2',
      scopes: [{ serverId: 'srv-2', libraryId: 'lib-b' }],
      localFallback: fallback,
      tracksFingerprint: 'tracks-2',
    });

    expect(result.map(track => track.id)).toEqual([
      'local-0', 'local-1', 'local-2', 'local-3', 'local-4',
    ]);
    expect(libraryGetTracksBatchMock).not.toHaveBeenCalled();
  });

  it('coalesces concurrent requests for the same artist scope', async () => {
    let resolveNetwork!: (songs: SubsonicSong[]) => void;
    getTopSongsForServerMock.mockReturnValue(new Promise(resolve => {
      resolveNetwork = resolve;
    }));
    libraryGetTracksBatchMock.mockResolvedValue([indexedTrack('global', 'lib-b')]);
    const options = {
      artistName: 'Unique Artist Three',
      sourceServerId: 'srv-2',
      scopes: [{ serverId: 'srv-2', libraryId: 'lib-b' }],
      localFallback: [song('local', 'Local')],
      tracksFingerprint: 'tracks-3',
    };

    const first = loadScopedArtistTopSongs(options);
    const second = loadScopedArtistTopSongs(options);
    expect(getTopSongsForServerMock).toHaveBeenCalledOnce();

    resolveNetwork([song('global', 'Global')]);
    await expect(first).resolves.toEqual([
      expect.objectContaining({ id: 'global' }),
      expect.objectContaining({ id: 'local' }),
    ]);
    await expect(second).resolves.toEqual([
      expect.objectContaining({ id: 'global' }),
      expect.objectContaining({ id: 'local' }),
    ]);
  });

  it('falls back when scoped batch validation remains pending', async () => {
    vi.useFakeTimers();
    getTopSongsForServerMock.mockResolvedValue([song('global-pending', 'Global Pending')]);
    libraryGetTracksBatchMock.mockReturnValue(new Promise(() => {}));

    const request = loadScopedArtistTopSongs({
      artistName: 'Unique Artist Pending Batch',
      sourceServerId: 'srv-2',
      scopes: [{ serverId: 'srv-2', libraryId: 'lib-b' }],
      localFallback: [song('local-pending', 'Local Pending')],
      tracksFingerprint: 'tracks-pending',
    });
    await vi.advanceTimersByTimeAsync(2000);

    await expect(request).resolves.toEqual([
      expect.objectContaining({ id: 'local-pending' }),
    ]);
  });

  it('caches successful rankings until the scoped track fingerprint changes', async () => {
    getTopSongsForServerMock
      .mockResolvedValueOnce([song('global-v1', 'Global V1')])
      .mockResolvedValueOnce([song('global-v2', 'Global V2')]);
    libraryGetTracksBatchMock
      .mockResolvedValueOnce([indexedTrack('global-v1', 'lib-b')])
      .mockResolvedValueOnce([indexedTrack('global-v2', 'lib-b')]);
    const options = {
      artistName: 'Unique Artist Fingerprint Cache',
      sourceServerId: 'srv-2',
      scopes: [{ serverId: 'srv-2', libraryId: 'lib-b' }],
      localFallback: [song('local', 'Local')],
      tracksFingerprint: 'tracks-v1',
    };

    await expect(loadScopedArtistTopSongs(options)).resolves.toEqual([
      expect.objectContaining({ id: 'global-v1' }),
      expect.objectContaining({ id: 'local' }),
    ]);
    await expect(loadScopedArtistTopSongs({
      ...options,
      localFallback: [song('local-new', 'Local New')],
    })).resolves.toEqual([
      expect.objectContaining({ id: 'global-v1' }),
      expect.objectContaining({ id: 'local-new' }),
    ]);
    expect(getTopSongsForServerMock).toHaveBeenCalledTimes(1);

    await expect(loadScopedArtistTopSongs({
      ...options,
      tracksFingerprint: 'tracks-v2',
    })).resolves.toEqual([
      expect.objectContaining({ id: 'global-v2' }),
      expect.objectContaining({ id: 'local' }),
    ]);
    expect(getTopSongsForServerMock).toHaveBeenCalledTimes(2);
  });

  it('accepts OpenSubsonic isrc arrays when merging Top Songs', async () => {
    getTopSongsForServerMock.mockResolvedValue([
      { ...song('global-isrc', 'Global ISRC'), isrc: ['USRC17607839'] },
    ]);
    libraryGetTracksBatchMock.mockResolvedValue([indexedTrack('global-isrc', 'lib-b')]);

    await expect(loadScopedArtistTopSongs({
      artistName: 'Unique Artist ISRC Array',
      sourceServerId: 'srv-2',
      scopes: [{ serverId: 'srv-2', libraryId: 'lib-b' }],
      localFallback: [],
      tracksFingerprint: 'tracks-isrc-array',
    })).resolves.toEqual([
      expect.objectContaining({ id: 'global-isrc' }),
    ]);
  });

});
