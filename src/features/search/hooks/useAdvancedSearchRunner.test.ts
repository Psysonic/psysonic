import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { useAuthStore } from '@/store/authStore';
import {
  resetServerReachabilitySnapshot,
  setServerReachability,
} from '@/lib/network/serverReachability';

const {
  readyLibraryServerKeysMock,
  localSearchMock,
  loadMoreLocalSongsMock,
  networkAdvancedTextSearchMock,
  networkBrowseFullSearchMock,
} = vi.hoisted(() => ({
  readyLibraryServerKeysMock: vi.fn(),
  localSearchMock: vi.fn(),
  loadMoreLocalSongsMock: vi.fn(),
  networkAdvancedTextSearchMock: vi.fn(),
  networkBrowseFullSearchMock: vi.fn(),
}));

vi.mock('@/lib/library/libraryReady', () => ({
  readyLibraryServerKeys: readyLibraryServerKeysMock,
}));

vi.mock('@/lib/library/advancedSearchLocal', () => ({
  loadMoreLocalSongs: loadMoreLocalSongsMock,
  runNetworkAdvancedTextSearch: networkAdvancedTextSearchMock,
  runNetworkAdvancedYearAlbums: vi.fn(),
  tryRunLocalAdvancedSearch: localSearchMock,
}));

vi.mock('@/lib/library/browseTextSearch', () => ({
  browseRaceCountsFullSearch: vi.fn(),
  loadMoreLocalBrowseSongs: vi.fn(),
  raceBrowseWithLocalFallback: vi.fn(),
  runLocalBrowseFullSearch: localSearchMock,
  runNetworkBrowseFullSearch: networkBrowseFullSearchMock,
}));

import { useAdvancedSearchRunner } from './useAdvancedSearchRunner';

function setters() {
  return {
    librarySyncRevision: 0,
    onResultsCommitted: vi.fn(),
    setLoading: vi.fn(),
    setHasSearched: vi.fn(),
    setGenreNote: vi.fn(),
    setBasicSearchMode: vi.fn(),
    setQuery: vi.fn(),
    setActiveSearch: vi.fn(),
    setSongsServerOffset: vi.fn(),
    setSongsHasMore: vi.fn(),
    setLocalMode: vi.fn(),
    setResults: vi.fn(),
    setLoadingMoreSongs: vi.fn(),
  };
}

beforeEach(() => {
  resetServerReachabilitySnapshot();
  resetAuthStore();
  readyLibraryServerKeysMock.mockReset().mockResolvedValue(null);
  localSearchMock.mockReset();
  loadMoreLocalSongsMock.mockReset();
  networkAdvancedTextSearchMock.mockReset().mockResolvedValue(null);
  networkBrowseFullSearchMock.mockReset().mockResolvedValue(null);
  useAuthStore.setState({
    activeServerId: 'a',
    servers: [
      { id: 'a', name: 'A', url: 'https://a.test', username: 'u', password: 'p' },
      { id: 'b', name: 'B', url: 'https://b.test', username: 'u', password: 'p' },
    ],
    libraryBrowseServerIds: ['a', 'b'],
    musicFoldersByServer: {
      a: [{ id: 'lib-a', name: 'A' }],
      b: [{ id: 'lib-b', name: 'B' }],
    },
    libraryBrowseSelectionByServer: {},
  });
});

describe('useAdvancedSearchRunner multi-server readiness', () => {
  it('does not fall back to the active server when every selected owner is unavailable', async () => {
    setServerReachability('a', 'unavailable');
    setServerReachability('b', 'unavailable');
    const state = setters();
    const { result } = renderHook(() => useAdvancedSearchRunner({
      serverId: 'a',
      indexEnabled: true,
      loadingMoreSongs: false,
      songsHasMore: false,
      activeSearch: null,
      basicSearchMode: true,
      localMode: false,
      songsServerOffset: 0,
      ...state,
    }));

    await act(async () => { await result.current.runBasicSearch('metallica'); });

    expect(localSearchMock).not.toHaveBeenCalled();
    expect(networkBrowseFullSearchMock).not.toHaveBeenCalled();
    expect(state.setResults).toHaveBeenLastCalledWith({ artists: [], albums: [], songs: [] });
  });

  it('retains existing basic-search state during a partial sync refresh', async () => {
    const state = setters();
    const { result } = renderHook(() => useAdvancedSearchRunner({
      serverId: 'a',
      indexEnabled: true,
      loadingMoreSongs: false,
      songsHasMore: false,
      activeSearch: null,
      basicSearchMode: true,
      localMode: true,
      songsServerOffset: 1,
      ...state,
    }));

    await act(async () => { await result.current.runBasicSearch('metallica'); });

    expect(readyLibraryServerKeysMock).toHaveBeenCalledWith(['a', 'b']);
    expect(localSearchMock).not.toHaveBeenCalled();
    expect(state.setResults).not.toHaveBeenCalled();
    expect(state.setLoading).toHaveBeenCalledWith(false);
    expect(state.setLocalMode).not.toHaveBeenCalled();
    expect(state.setQuery).toHaveBeenCalledWith('metallica');
    expect(state.setActiveSearch).toHaveBeenCalledWith(expect.objectContaining({ query: 'metallica' }));
  });

  it('retains existing advanced-search state during a partial sync refresh', async () => {
    const state = setters();
    const { result } = renderHook(() => useAdvancedSearchRunner({
      serverId: 'a',
      indexEnabled: true,
      loadingMoreSongs: false,
      songsHasMore: false,
      activeSearch: null,
      basicSearchMode: false,
      localMode: true,
      songsServerOffset: 1,
      ...state,
    }));

    const pending = {
      query: 'metallica', genre: '', yearFrom: '', yearTo: '', bpmFrom: '', bpmTo: '',
      moodGroup: '', losslessOnly: false, resultType: 'all' as const,
    };
    await act(async () => { await result.current.runSearch(pending); });

    expect(localSearchMock).not.toHaveBeenCalled();
    expect(state.setResults).not.toHaveBeenCalled();
    expect(state.setLoading).toHaveBeenCalledWith(false);
    expect(state.setSongsHasMore).not.toHaveBeenCalled();
    expect(state.setActiveSearch).toHaveBeenCalledWith(pending);
  });

  it('retains filter-only advanced-search state during a partial sync refresh', async () => {
    const state = setters();
    const { result } = renderHook(() => useAdvancedSearchRunner({
      serverId: 'a',
      indexEnabled: true,
      loadingMoreSongs: false,
      songsHasMore: false,
      activeSearch: null,
      basicSearchMode: false,
      localMode: true,
      songsServerOffset: 1,
      ...state,
    }));

    await act(async () => {
      await result.current.runSearch({
        query: '', genre: 'metal', yearFrom: '', yearTo: '', bpmFrom: '', bpmTo: '',
        moodGroup: '', losslessOnly: false, resultType: 'all',
      });
    });

    expect(readyLibraryServerKeysMock).toHaveBeenCalledWith(['a', 'b']);
    expect(localSearchMock).not.toHaveBeenCalled();
    expect(state.setResults).not.toHaveBeenCalled();
    expect(state.setLoading).toHaveBeenCalledWith(false);
  });

  it('retains advanced-search state when local readiness changes before the read', async () => {
    readyLibraryServerKeysMock.mockResolvedValue(['a.test', 'b.test']);
    localSearchMock.mockResolvedValue(null);
    const state = setters();
    const { result } = renderHook(() => useAdvancedSearchRunner({
      serverId: 'a',
      indexEnabled: true,
      loadingMoreSongs: false,
      songsHasMore: false,
      activeSearch: null,
      basicSearchMode: false,
      localMode: true,
      songsServerOffset: 1,
      ...state,
    }));

    await act(async () => {
      await result.current.runSearch({
        query: 'metallica', genre: '', yearFrom: '', yearTo: '', bpmFrom: '', bpmTo: '',
        moodGroup: '', losslessOnly: false, resultType: 'all',
      });
    });

    expect(localSearchMock).toHaveBeenCalledOnce();
    expect(state.setResults).not.toHaveBeenCalled();
    expect(state.setLoading).toHaveBeenCalledWith(false);
    expect(state.setLocalMode).not.toHaveBeenCalled();
  });

  it('retains basic-search state when local readiness changes before the read', async () => {
    readyLibraryServerKeysMock.mockResolvedValue(['a.test', 'b.test']);
    localSearchMock.mockResolvedValue(null);
    const state = setters();
    const { result } = renderHook(() => useAdvancedSearchRunner({
      serverId: 'a',
      indexEnabled: true,
      loadingMoreSongs: false,
      songsHasMore: false,
      activeSearch: null,
      basicSearchMode: true,
      localMode: true,
      songsServerOffset: 1,
      ...state,
    }));

    await act(async () => { await result.current.runBasicSearch('metallica'); });

    expect(localSearchMock).toHaveBeenCalledOnce();
    expect(state.setResults).not.toHaveBeenCalled();
    expect(state.setLoading).toHaveBeenCalledWith(false);
    expect(state.setLocalMode).not.toHaveBeenCalled();
  });

  it('uses the selected browse anchor when the active server is not selected', async () => {
    useAuthStore.setState({ libraryBrowseServerIds: ['b'] });
    localSearchMock.mockResolvedValue({
      artists: [], albums: [], songs: [], songsConsumed: 0, songsTotal: 0,
    });
    const state = setters();
    const { result } = renderHook(() => useAdvancedSearchRunner({
      serverId: 'a',
      indexEnabled: true,
      loadingMoreSongs: false,
      songsHasMore: false,
      activeSearch: null,
      basicSearchMode: false,
      localMode: false,
      songsServerOffset: 0,
      ...state,
    }));

    const search = {
      query: 'metallica', genre: '', yearFrom: '', yearTo: '', bpmFrom: '', bpmTo: '',
      moodGroup: '', losslessOnly: true, resultType: 'all' as const,
    };
    await act(async () => { await result.current.runSearch(search); });

    expect(localSearchMock).toHaveBeenCalledWith(
      'b',
      search,
      100,
      false,
      expect.objectContaining({ anchorServerId: 'b' }),
    );
  });

  it('clears results from the previous scope when a newly selected owner is not ready', async () => {
    useAuthStore.setState({ libraryBrowseServerIds: ['a'] });
    readyLibraryServerKeysMock.mockResolvedValue(['a.test']);
    localSearchMock.mockResolvedValue({
      artists: [],
      albums: [],
      songs: [{ id: 'a-song' }],
      songsConsumed: 1,
      songsTotal: 1,
    });
    const state = setters();
    const view = renderHook(() => useAdvancedSearchRunner({
      serverId: 'a',
      indexEnabled: true,
      loadingMoreSongs: false,
      songsHasMore: false,
      activeSearch: null,
      basicSearchMode: false,
      localMode: false,
      songsServerOffset: 0,
      ...state,
    }));
    const search = {
      query: 'metallica', genre: '', yearFrom: '', yearTo: '', bpmFrom: '', bpmTo: '',
      moodGroup: '', losslessOnly: false, resultType: 'all' as const,
    };

    await act(async () => { await view.result.current.runSearch(search); });
    expect(state.setResults).toHaveBeenLastCalledWith(expect.objectContaining({
      songs: [{ id: 'a-song' }],
    }));

    useAuthStore.setState({ libraryBrowseServerIds: ['a', 'b'] });
    readyLibraryServerKeysMock.mockResolvedValue(null);
    view.rerender();
    await act(async () => { await view.result.current.runSearch(search); });

    expect(state.setResults).toHaveBeenLastCalledWith({ artists: [], albums: [], songs: [] });
  });

  it('keeps the committed result provenance while the same scope refresh is not ready', async () => {
    readyLibraryServerKeysMock.mockResolvedValue(['a.test', 'b.test']);
    localSearchMock.mockResolvedValue({
      artists: [], albums: [], songs: [{ id: 'current' }], songsConsumed: 1, songsTotal: 1,
    });
    const state = setters();
    const view = renderHook(
      ({ librarySyncRevision }) => useAdvancedSearchRunner({
        serverId: 'a',
        indexEnabled: true,
        loadingMoreSongs: false,
        songsHasMore: false,
        activeSearch: null,
        basicSearchMode: false,
        localMode: false,
        songsServerOffset: 0,
        ...state,
        librarySyncRevision,
      }),
      { initialProps: { librarySyncRevision: 0 } },
    );
    const search = {
      query: 'metallica', genre: '', yearFrom: '', yearTo: '', bpmFrom: '', bpmTo: '',
      moodGroup: '', losslessOnly: false, resultType: 'all' as const,
    };

    await act(async () => { await view.result.current.runSearch(search); });
    expect(state.onResultsCommitted).toHaveBeenLastCalledWith(
      expect.any(String),
      0,
    );

    readyLibraryServerKeysMock.mockResolvedValue(null);
    view.rerender({ librarySyncRevision: 1 });
    await act(async () => { await view.result.current.runSearch(search); });

    expect(state.onResultsCommitted).toHaveBeenCalledTimes(1);
    expect(state.setResults).toHaveBeenCalledTimes(1);
  });

  it('uses the raw network page size for filtered pagination offset', async () => {
    useAuthStore.setState({ libraryBrowseServerIds: ['a'] });
    localSearchMock.mockResolvedValue(null);
    networkAdvancedTextSearchMock.mockResolvedValue({
      artists: [],
      albums: [],
      songs: [{ id: 'matching-song' }],
      songsConsumed: 100,
      songsTotal: 1,
    });
    const state = setters();
    const { result } = renderHook(() => useAdvancedSearchRunner({
      serverId: 'a',
      indexEnabled: true,
      loadingMoreSongs: false,
      songsHasMore: false,
      activeSearch: null,
      basicSearchMode: false,
      localMode: false,
      songsServerOffset: 0,
      ...state,
    }));

    await act(async () => {
      await result.current.runSearch({
        query: 'metallica', genre: 'metal', yearFrom: '', yearTo: '', bpmFrom: '', bpmTo: '',
        moodGroup: '', losslessOnly: false, resultType: 'songs',
      });
    });

    expect(state.setSongsServerOffset).toHaveBeenLastCalledWith(100);
    expect(state.setSongsHasMore).toHaveBeenLastCalledWith(true);
  });

  it('does not append a stale local page after a newer search starts', async () => {
    let resolvePage!: (songs: Array<{ id: string }>) => void;
    loadMoreLocalSongsMock.mockReturnValueOnce(new Promise(resolve => {
      resolvePage = resolve;
    }));
    readyLibraryServerKeysMock.mockResolvedValue(['a.test', 'b.test']);
    localSearchMock.mockResolvedValue({
      artists: [], albums: [], songs: [], songsConsumed: 0, songsTotal: 0,
    });
    const state = setters();
    const activeSearch = {
      query: 'old', genre: '', yearFrom: '', yearTo: '', bpmFrom: '', bpmTo: '',
      moodGroup: '', losslessOnly: false, resultType: 'all' as const,
    };
    const { result } = renderHook(() => useAdvancedSearchRunner({
      serverId: 'a',
      indexEnabled: true,
      loadingMoreSongs: false,
      songsHasMore: true,
      activeSearch,
      basicSearchMode: false,
      localMode: true,
      songsServerOffset: 1,
      ...state,
    }));

    const loadMorePromise = result.current.loadMoreSongs();
    await act(async () => {
      await result.current.runSearch({ ...activeSearch, query: 'new' });
    });
    const callsAfterSearch = state.setResults.mock.calls.length;
    await act(async () => {
      resolvePage([{ id: 'stale' }]);
      await loadMorePromise;
    });

    expect(state.setResults).toHaveBeenCalledTimes(callsAfterSearch);
  });
});

describe('Octo catalog search', () => {
  it('queries the selected proxy even with a ready multi-server index and merges owned results', async () => {
    useAuthStore.setState({ openSubsonicExtensionsByServer: { b: ['octoAcquisitions'] } });
    const remote = { id: 'preview', title: 'Remote', artist: 'Artist', album: 'Album', albumId: 'remote-album', duration: 0, serverId: 'b.test', isExternal: true };
    networkAdvancedTextSearchMock.mockResolvedValue({ artists: [], albums: [], songs: [remote], songsConsumed: 1 });
    localSearchMock.mockResolvedValue({ artists: [], albums: [], songs: [{ ...remote, id: 'local', serverId: 'a.test' }], songsConsumed: 1 });
    const state = setters();
    const { result } = renderHook(() => useAdvancedSearchRunner({
      serverId: 'a', indexEnabled: true, loadingMoreSongs: false, songsHasMore: false,
      activeSearch: null, basicSearchMode: true, localMode: false, songsServerOffset: 0, ...state,
    }));
    await act(async () => { await result.current.runBasicSearch('artist'); });
    expect(networkAdvancedTextSearchMock).toHaveBeenCalledWith(expect.objectContaining({ query: 'artist' }), 50, 'b', 30000);
    expect(state.setResults).toHaveBeenLastCalledWith(expect.objectContaining({ songs: [remote, expect.objectContaining({ id: 'local' })] }));
    expect(readyLibraryServerKeysMock).not.toHaveBeenCalled();
  });
  it('does not query an Octo server outside the selected browse scope', async () => {
    useAuthStore.setState({ libraryBrowseServerIds: ['a'], openSubsonicExtensionsByServer: { b: ['octoAcquisitions'] } });
    const state = setters();
    const { result } = renderHook(() => useAdvancedSearchRunner({
      serverId: 'a', indexEnabled: true, loadingMoreSongs: false, songsHasMore: false,
      activeSearch: null, basicSearchMode: true, localMode: false, songsServerOffset: 0, ...state,
    }));
    await act(async () => { await result.current.runBasicSearch('artist'); });
    expect(networkAdvancedTextSearchMock).not.toHaveBeenCalled();
  });
});
