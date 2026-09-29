import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InternetRadioStation } from '@/lib/api/subsonicTypes';

const hoisted = vi.hoisted(() => ({
  getRadio: vi.fn(),
  loadStarredFromAllServersOnline: vi.fn(),
}));

vi.mock('@/lib/api/subsonicRadio', () => ({
  getInternetRadioStationsForServersSettled: hoisted.getRadio,
}));
vi.mock('@/features/playback/store/playerStore', () => ({
  usePlayerStore: Object.assign(
    (selector: (state: { starredOverrides: Record<string, boolean> }) => unknown) => (
      selector({ starredOverrides: {} })
    ),
    {
      getState: () => ({ starredOverrides: {} }),
      setState: vi.fn(),
    },
  ),
}));
vi.mock('@/lib/hooks/useConnectionStatus', () => ({
  useConnectionStatus: () => ({ status: 'connected' }),
}));
vi.mock('@/lib/network/activeServerReachability', () => ({
  isActiveServerReachable: () => true,
}));
vi.mock('@/features/offline', () => ({
  useOfflineBrowseContext: () => ({ active: false }),
  useOfflineBrowseReloadToken: () => 0,
  loadStarredFromAllLibraryIndexes: vi.fn(async () => ({ albums: [], artists: [], songs: [] })),
  loadStarredFromAllServersOnline: (...args: unknown[]) => hoisted.loadStarredFromAllServersOnline(...args),
}));
vi.mock('@/lib/library/favoritesBrowseDebug', () => ({
  beginFavoritesBrowseTrace: vi.fn(),
  emitFavoritesBrowseDebug: vi.fn(),
  favoritesBrowseTimed: (_name: string, run: () => Promise<unknown>) => run(),
}));

import { useFavoritesData } from './useFavoritesData';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { useAuthStore } from '@/store/authStore';
import { notifyFavoritesChanged } from '@/lib/library/favoritesRevision';

const STATION: InternetRadioStation = {
  id: 'shared',
  serverId: 'srv-a',
  name: 'Alpha Radio',
  streamUrl: 'https://a.test/live',
};

describe('useFavoritesData radio ownership', () => {
  beforeEach(() => {
    resetAuthStore();
    localStorage.clear();
    hoisted.getRadio.mockReset();
    hoisted.loadStarredFromAllServersOnline.mockReset().mockResolvedValue({
      albums: [],
      artists: [],
      songs: [],
    });
    useAuthStore.setState({
      isLoggedIn: true,
      servers: [{
        id: 'srv-a',
        name: 'Home',
        url: 'https://a.test',
        username: 'a',
        password: 'p',
      }],
      activeServerId: 'srv-a',
      libraryBrowseServerIds: ['srv-a'],
      favoritesOfflineEnabled: false,
    });
  });

  it('does not restore an unfavorited station from an older refresh', async () => {
    localStorage.setItem('psysonic_radio_favorites', JSON.stringify([
      'shared',
      'srv-a:shared',
    ]));
    let resolveRadio: ((value: {
      stations: InternetRadioStation[];
      failedServerIds: string[];
    }) => void) | undefined;
    hoisted.getRadio.mockImplementation(() => new Promise(resolve => {
      resolveRadio = resolve;
    }));
    const { result } = renderHook(() => useFavoritesData());
    await waitFor(() => expect(hoisted.getRadio).toHaveBeenCalled());

    act(() => result.current.unfavoriteStation(STATION));
    act(() => resolveRadio?.({ stations: [STATION], failedServerIds: [] }));

    await waitFor(() => expect(result.current.radioStations).toEqual([]));
    expect(JSON.parse(localStorage.getItem('psysonic_radio_favorites') ?? '[]')).toEqual([]);
  });

  it('loads online favorites from the whole configured browse cluster', async () => {
    useAuthStore.setState(state => ({
      servers: [
        ...state.servers,
        {
          id: 'srv-b',
          name: 'Remote',
          url: 'https://b.test',
          username: 'b',
          password: 'p',
        },
      ],
      libraryBrowseServerIds: ['srv-a', 'srv-b'],
    }));
    hoisted.loadStarredFromAllServersOnline.mockResolvedValue({
      albums: [],
      artists: [{ id: 'artist-b', name: 'Remote Artist', serverId: 'srv-b' }],
      songs: [{
        id: 'song-b',
        title: 'Remote Song',
        artist: 'Remote Artist',
        duration: 1,
        serverId: 'srv-b',
      }],
    });

    const { result } = renderHook(() => useFavoritesData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(hoisted.loadStarredFromAllServersOnline).toHaveBeenCalledWith(['srv-a', 'srv-b']);
    expect(result.current.artists.map(artist => artist.id)).toEqual(['artist-b']);
    expect(result.current.songs.map(song => song.id)).toEqual(['song-b']);
  });

  it('reloads the cluster snapshot after a confirmed favorite mutation', async () => {
    hoisted.loadStarredFromAllServersOnline
      .mockResolvedValueOnce({ albums: [], artists: [], songs: [] })
      .mockResolvedValueOnce({
        albums: [],
        artists: [{ id: 'artist-new', name: 'New Artist', serverId: 'srv-a' }],
        songs: [],
      });
    const { result } = renderHook(() => useFavoritesData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => notifyFavoritesChanged());

    expect(result.current.loading).toBe(false);
    await waitFor(() => expect(result.current.artists.map(artist => artist.id)).toEqual([
      'artist-new',
    ]));
    expect(hoisted.loadStarredFromAllServersOnline).toHaveBeenCalledTimes(2);
  });
});
