import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';

const { resolveAlbumMock, matchesMock, sonicActiveMock, attemptMock } = vi.hoisted(() => ({
  resolveAlbumMock: vi.fn(),
  matchesMock: vi.fn(),
  sonicActiveMock: vi.fn(),
  attemptMock: vi.fn(),
}));

vi.mock('@/features/offline', () => ({ resolveAlbum: resolveAlbumMock }));
vi.mock('@/lib/api/subsonicArtists', () => ({ getSonicSimilarMatchesForServer: matchesMock }));
vi.mock('@/lib/serverCapabilities/storeView', () => ({ isSonicSimilarityActiveForServer: sonicActiveMock }));
vi.mock('@/lib/network/subsonicNetworkGuard', () => ({ shouldAttemptSubsonicForServer: attemptMock }));

import { resolveSonicPicks } from '@/features/home/utils/becauseYouLikeSonicPicks';

const anchor = { id: 'anchor-artist', name: 'Anchor', serverId: 'srv', seedAlbumId: 'seed-album' };

function song(id: string, albumId: string, artistId: string): SubsonicSong {
  return {
    id,
    title: id,
    album: `Album ${albumId}`,
    albumId,
    artist: `Artist ${artistId}`,
    artistId,
    duration: 1,
  } as SubsonicSong;
}

function match(albumId: string, artistId: string, similarity: number) {
  return { song: song(`t-${albumId}-${similarity}`, albumId, artistId), similarity };
}

describe('resolveSonicPicks', () => {
  beforeEach(() => {
    resolveAlbumMock.mockReset();
    matchesMock.mockReset();
    sonicActiveMock.mockReset();
    attemptMock.mockReset();
    sonicActiveMock.mockReturnValue(true);
    attemptMock.mockReturnValue(true);
    resolveAlbumMock.mockResolvedValue({
      album: { id: 'seed-album' },
      songs: [song('s1', 'seed-album', 'anchor-artist'), song('s2', 'seed-album', 'anchor-artist')],
    });
  });

  it('does nothing on a server without sonic similarity', async () => {
    sonicActiveMock.mockReturnValue(false);
    expect(await resolveSonicPicks(anchor, new Set(), 3)).toBeNull();
    expect(resolveAlbumMock).not.toHaveBeenCalled();
    expect(matchesMock).not.toHaveBeenCalled();
  });

  it('does nothing without a seed album', async () => {
    expect(await resolveSonicPicks({ ...anchor, seedAlbumId: undefined }, new Set(), 3)).toBeNull();
    expect(matchesMock).not.toHaveBeenCalled();
  });

  it('returns null when nothing matched so the caller can fall back', async () => {
    matchesMock.mockResolvedValue([]);
    expect(await resolveSonicPicks(anchor, new Set(), 3)).toBeNull();
  });

  it('seeds the lookup with tracks of the anchor album', async () => {
    matchesMock.mockResolvedValue([match('a1', 'other', 0.9)]);
    await resolveSonicPicks(anchor, new Set(), 3);
    expect(resolveAlbumMock).toHaveBeenCalledWith('srv', 'seed-album');
    expect(matchesMock.mock.calls.map(c => c[1]).sort()).toEqual(['s1', 's2']);
    for (const call of matchesMock.mock.calls) expect(call[0]).toBe('srv');
  });

  it('prefers one album per artist, skips recent picks and leaves out the anchor artist', async () => {
    matchesMock.mockResolvedValue([
      match('own', 'anchor-artist', 0.99),
      match('x1', 'artist-x', 0.95),
      match('x2', 'artist-x', 0.94),
      match('recent', 'artist-r', 0.93),
      match('y1', 'artist-y', 0.5),
    ]);

    const picks = await resolveSonicPicks(anchor, new Set(['srv:recent']), 3);

    expect(picks?.map(p => p.id)).toEqual(['x1', 'y1', 'x2']);
    for (const pick of picks ?? []) expect(pick.serverId).toBe('srv');
  });

  it('still fills the rail from recent picks when nothing fresh is left', async () => {
    matchesMock.mockResolvedValue([match('recent', 'artist-r', 0.9)]);
    const picks = await resolveSonicPicks(anchor, new Set(['srv:recent']), 3);
    expect(picks?.map(p => p.id)).toEqual(['recent']);
  });
});
