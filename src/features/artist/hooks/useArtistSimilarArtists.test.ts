import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAuthStore } from '@/store/authStore';
import type { SubsonicArtist, SubsonicArtistInfo } from '@/lib/api/subsonicTypes';

const getSimilarArtists = vi.hoisted(() => vi.fn());

vi.mock('@/music-network', () => ({
  getMusicNetworkRuntime: () => ({ getSimilarArtists }),
}));
vi.mock('@/lib/api/subsonicSearch');

import { search, searchForServer } from '@/lib/api/subsonicSearch';
import {
  useArtistSimilarArtists,
  type ArtistSimilarArtistsResult,
} from '@/features/artist/hooks/useArtistSimilarArtists';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

describe('useArtistSimilarArtists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      activeServerId: 'srv-a',
      enrichmentPrimaryId: 'lastfm',
      audiomuseNavidromeByServer: {},
    });
    getSimilarArtists.mockResolvedValue(['Other Artist']);
    vi.mocked(searchForServer).mockResolvedValue({
      artists: [{ id: 'other-1', name: 'Other Artist', serverId: 'srv-b' }],
      albums: [],
      songs: [],
    });
  });

  it('resolves network similar artists through the detail owner server', async () => {
    const { result } = renderHook(() => useArtistSimilarArtists(
      { id: 'artist-1', name: 'Artist', serverId: 'srv-b' },
      null,
      false,
      'srv-b',
    ));

    await waitFor(() => expect(result.current.similarArtists).toEqual([
      { id: 'other-1', name: 'Other Artist', serverId: 'srv-b' },
    ]));
    expect(result.current.similarLoading).toBe(false);
    expect(searchForServer).toHaveBeenCalledWith('srv-b', 'Other Artist', {
      artistCount: 3,
      albumCount: 0,
      songCount: 0,
    });
    expect(search).not.toHaveBeenCalled();
  });

  it('reports loading from the first render, before the lookup has been started', () => {
    // The page reads "not loading and empty" as "fall back to the server's list"; a first
    // render that looked settled would flash that list before the chosen service answers.
    getSimilarArtists.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useArtistSimilarArtists(
      { id: 'artist-1', name: 'Artist' },
      null,
      false,
      'srv-b',
    ));

    expect(result.current.similarLoading).toBe(true);
    expect(result.current.similarArtists).toEqual([]);
  });

  it('settles empty when the lookup finds nothing in the library', async () => {
    vi.mocked(searchForServer).mockResolvedValue({ artists: [], albums: [], songs: [] });

    const { result } = renderHook(() => useArtistSimilarArtists(
      { id: 'artist-1', name: 'Artist' },
      null,
      false,
      'srv-b',
    ));

    await waitFor(() => expect(result.current.similarLoading).toBe(false));
    expect(getSimilarArtists).toHaveBeenCalledWith('Artist');
    expect(result.current.similarArtists).toEqual([]);
  });

  it('settles empty when the service lookup fails', async () => {
    getSimilarArtists.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useArtistSimilarArtists(
      { id: 'artist-1', name: 'Artist' },
      null,
      false,
      'srv-b',
    ));

    await waitFor(() => expect(result.current.similarLoading).toBe(false));
    expect(result.current.similarArtists).toEqual([]);
  });

  it('runs no lookup and is settled at once when no Music Network service is set up', () => {
    useAuthStore.setState({ enrichmentPrimaryId: null });

    const { result } = renderHook(() => useArtistSimilarArtists(
      { id: 'artist-1', name: 'Artist' },
      null,
      false,
      'srv-b',
    ));

    expect(result.current.similarLoading).toBe(false);
    expect(result.current.similarArtists).toEqual([]);
    expect(getSimilarArtists).not.toHaveBeenCalled();
  });

  it('keeps the next artist loading when the previous artist answers late', async () => {
    const first = deferred<string[]>();
    const second = deferred<string[]>();
    getSimilarArtists.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(
      ({ artist }: { artist: SubsonicArtist }) => useArtistSimilarArtists(artist, null, false, 'srv-b'),
      { initialProps: { artist: { id: 'artist-1', name: 'First' } } },
    );
    rerender({ artist: { id: 'artist-2', name: 'Second' } });

    await act(async () => { first.resolve(['Other Artist']); });
    expect(result.current.similarLoading).toBe(true);
    expect(result.current.similarArtists).toEqual([]);

    await act(async () => { second.resolve([]); });
    await waitFor(() => expect(result.current.similarLoading).toBe(false));
    expect(result.current.similarArtists).toEqual([]);
  });

  it('never hands the next artist the previous artist\'s matches, not even for one render', async () => {
    // The render right after navigation still holds the previous lookup in state. Read as
    // this artist's settled answer it would briefly show the wrong artists, or — when that
    // answer was empty — make the page fall back to the server list before the new lookup ran.
    const seen: Array<{ artistId: string; result: ArtistSimilarArtistsResult }> = [];
    const { rerender } = renderHook(
      ({ artist }: { artist: SubsonicArtist }) => {
        const result = useArtistSimilarArtists(artist, null, false, 'srv-b');
        seen.push({ artistId: artist.id, result });
        return result;
      },
      { initialProps: { artist: { id: 'artist-1', name: 'First' } } },
    );
    await waitFor(() => expect(seen[seen.length - 1].result.similarArtists).toHaveLength(1));

    getSimilarArtists.mockReturnValue(new Promise(() => {}));
    rerender({ artist: { id: 'artist-2', name: 'Second' } });

    const forSecond = seen.filter(entry => entry.artistId === 'artist-2');
    expect(forSecond.length).toBeGreaterThan(0);
    for (const { result } of forSecond) {
      expect(result).toEqual({ similarArtists: [], similarLoading: true });
    }
  });

  it('keeps the next artist settled when the previous artist answers after it', async () => {
    const first = deferred<string[]>();
    const second = deferred<string[]>();
    getSimilarArtists.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(
      ({ artist }: { artist: SubsonicArtist }) => useArtistSimilarArtists(artist, null, false, 'srv-b'),
      { initialProps: { artist: { id: 'artist-1', name: 'First' } } },
    );
    rerender({ artist: { id: 'artist-2', name: 'Second' } });

    await act(async () => { second.resolve(['Other Artist']); });
    await waitFor(() => expect(result.current.similarLoading).toBe(false));

    await act(async () => { first.resolve([]); });
    expect(result.current.similarLoading).toBe(false);
    expect(result.current.similarArtists).toEqual([
      { id: 'other-1', name: 'Other Artist', serverId: 'srv-b' },
    ]);
  });

  it('skips the lookup under AudioMuse while the server has its own list', () => {
    useAuthStore.setState({ audiomuseNavidromeByServer: { 'srv-b': true } });
    const info: SubsonicArtistInfo = { similarArtist: [{ id: 'sim-1', name: 'Server Pick' }] };

    const { result } = renderHook(() => useArtistSimilarArtists(
      { id: 'artist-1', name: 'Artist' },
      info,
      false,
      'srv-b',
    ));

    expect(result.current.similarLoading).toBe(false);
    expect(getSimilarArtists).not.toHaveBeenCalled();
  });

  it('falls back to the lookup under AudioMuse once the server list comes back empty', async () => {
    useAuthStore.setState({ audiomuseNavidromeByServer: { 'srv-b': true } });

    const { result, rerender } = renderHook(
      ({ info, infoLoading }: { info: SubsonicArtistInfo | null; infoLoading: boolean }) =>
        useArtistSimilarArtists({ id: 'artist-1', name: 'Artist' }, info, infoLoading, 'srv-b'),
      { initialProps: { info: null as SubsonicArtistInfo | null, infoLoading: true } },
    );
    expect(result.current.similarLoading).toBe(false);
    expect(getSimilarArtists).not.toHaveBeenCalled();

    rerender({ info: {}, infoLoading: false });

    await waitFor(() => expect(result.current.similarArtists).toEqual([
      { id: 'other-1', name: 'Other Artist', serverId: 'srv-b' },
    ]));
    expect(getSimilarArtists).toHaveBeenCalledTimes(1);
  });
});
