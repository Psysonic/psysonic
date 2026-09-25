import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAuthStore } from '@/store/authStore';
import type { SonicSimilarMatch } from '@/lib/api/subsonicArtists';
import { makeSubsonicSong } from '@/test/helpers/factories';

vi.mock('@/lib/api/subsonicArtists', () => ({ getSonicSimilarMatchesForServer: vi.fn() }));
vi.mock('@/lib/network/subsonicNetworkGuard', () => ({ shouldAttemptSubsonicForServer: () => true }));

import { getSonicSimilarMatchesForServer } from '@/lib/api/subsonicArtists';
import {
  resetAlbumSimilarAlbumsCacheForTests,
  useAlbumSimilarAlbums,
  type AlbumSimilarAlbumsInput,
} from '@/features/album/hooks/useAlbumSimilarAlbums';

const SID = 'srv-a';
const albumSongs = [makeSubsonicSong({ id: 'seed-1', albumId: 'cur' }), makeSubsonicSong({ id: 'seed-2', albumId: 'cur' })];

function similar(albumId: string, similarity = 0.9): SonicSimilarMatch {
  return {
    song: makeSubsonicSong({ albumId, album: `Album ${albumId}`, artistId: `artist-${albumId}`, serverId: SID }),
    similarity,
  };
}

function seedServer(probe: 'present' | 'absent') {
  useAuthStore.setState({
    subsonicServerIdentityByServer: { [SID]: { type: 'navidrome', serverVersion: '0.62.1', openSubsonic: true } },
    audiomusePluginProbeByServer: { [SID]: probe },
    openSubsonicExtensionsByServer: {},
    instantMixProbeByServer: {},
    audiomuseNavidromeByServer: { [SID]: probe === 'present' },
  } as never);
}

function input(overrides: Partial<AlbumSimilarAlbumsInput> = {}): AlbumSimilarAlbumsInput {
  return { serverId: SID, albumId: 'cur', artistId: 'me', songs: albumSongs, enabled: true, ...overrides };
}

describe('useAlbumSimilarAlbums', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAlbumSimilarAlbumsCacheForTests();
    seedServer('present');
  });

  it('aggregates sonic matches from every seed', async () => {
    vi.mocked(getSonicSimilarMatchesForServer).mockImplementation(async (_sid, id) =>
      id === 'seed-1' ? [similar('b'), similar('a')] : [similar('a')]);
    const { result } = renderHook(() => useAlbumSimilarAlbums(input()));
    await waitFor(() => expect(result.current.albums.map(a => a.id)).toEqual(['a', 'b']));
    expect(result.current.loading).toBe(false);
    expect(getSonicSimilarMatchesForServer).toHaveBeenCalledTimes(2);
  });

  it('does not fetch when the sonic strategy is absent', () => {
    seedServer('absent');
    const { result } = renderHook(() => useAlbumSimilarAlbums(input()));
    expect(result.current).toEqual({ albums: [], loading: false });
    expect(getSonicSimilarMatchesForServer).not.toHaveBeenCalled();
  });

  it('does not fetch when disabled by the page', () => {
    renderHook(() => useAlbumSimilarAlbums(input({ enabled: false })));
    expect(getSonicSimilarMatchesForServer).not.toHaveBeenCalled();
  });

  it('serves a revisit from the cache', async () => {
    vi.mocked(getSonicSimilarMatchesForServer).mockResolvedValue([similar('a')]);
    const first = renderHook(() => useAlbumSimilarAlbums(input()));
    await waitFor(() => expect(first.result.current.albums).toHaveLength(1));
    first.unmount();
    vi.mocked(getSonicSimilarMatchesForServer).mockClear();

    const second = renderHook(() => useAlbumSimilarAlbums(input()));
    await waitFor(() => expect(second.result.current.albums).toHaveLength(1));
    expect(getSonicSimilarMatchesForServer).not.toHaveBeenCalled();
  });

  it('drops a stale response after switching albums', async () => {
    let resolveOld!: (matches: SonicSimilarMatch[]) => void;
    vi.mocked(getSonicSimilarMatchesForServer)
      .mockImplementationOnce(() => new Promise(r => { resolveOld = r; }))
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue([similar('fresh')]);
    const { result, rerender } = renderHook((props: AlbumSimilarAlbumsInput) => useAlbumSimilarAlbums(props), {
      initialProps: input(),
    });
    rerender(input({ albumId: 'next', songs: [makeSubsonicSong({ id: 'n1', albumId: 'next' })] }));
    resolveOld([similar('stale')]);
    await waitFor(() => expect(result.current.albums.map(a => a.id)).toEqual(['fresh']));
  });
});
