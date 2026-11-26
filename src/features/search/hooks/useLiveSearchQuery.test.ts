import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAuthStore } from '@/store/authStore';
import { useLibraryIndexStore } from '@/store/libraryIndexStore';
import type { SyncStateDto } from '@/lib/api/library/dto';
import type { SearchResults } from '@/lib/api/subsonicTypes';
import { resetAuthStore } from '@/test/helpers/storeReset';

const {
  libraryGetStatusMock,
  runLocalLiveSearchMock,
  runNetworkLiveSearchMock,
  raceLiveSearchMock,
  showToastMock,
  subscribeLibrarySyncProgressMock,
  revisionState,
} = vi.hoisted(() => ({
  libraryGetStatusMock: vi.fn(),
  runNetworkLiveSearchMock: vi.fn(),
  runLocalLiveSearchMock: vi.fn<(
    serverId: string,
    query: string,
    context: unknown,
    browseScope?: unknown,
  ) => Promise<SearchResults | null>>(),
  raceLiveSearchMock: vi.fn(),
  showToastMock: vi.fn(),
  subscribeLibrarySyncProgressMock: vi.fn(async () => () => {}),
  revisionState: { value: 0 },
}));

vi.mock('@/lib/api/library', () => ({
  libraryGetStatus: (...args: unknown[]) => libraryGetStatusMock(...args),
  subscribeLibrarySyncIdle: vi.fn(async () => () => {}),
  subscribeLibrarySyncProgress: subscribeLibrarySyncProgressMock,
}));

vi.mock('@/lib/library/liveSearchLocal', () => ({
  LIVE_SEARCH_DEBOUNCE_NETWORK_MS: 500,
  LIVE_SEARCH_DEBOUNCE_RACE_MS: 500,
  EMPTY_SEARCH_RESULTS: { artists: [], albums: [], songs: [] },
  liveSearchQueryRejected: () => false,
  mergeLiveSearchResults: (primary: unknown) => primary,
  runLocalLiveSearch: runLocalLiveSearchMock,
  runNetworkLiveSearch: runNetworkLiveSearchMock,
}));

vi.mock('@/lib/library/searchRace', () => ({
  raceLiveSearch: raceLiveSearchMock,
}));

vi.mock('@/lib/library/liveSearchDebug', () => ({
  emitLiveSearchDebug: vi.fn(),
  searchHitCounts: () => 0,
  searchResultSamples: () => [],
}));

vi.mock('@/lib/library/libraryDevLog', () => ({
  logLibrarySearch: vi.fn(),
}));

vi.mock('@/lib/dom/toast', () => ({
  showToast: showToastMock,
}));

vi.mock('@/features/search/components/liveSearchScope', () => ({
  isLiveSearchDropdownBlocked: () => false,
}));

vi.mock('@/store/offlineLocalLibrarySyncRevision', () => ({
  useLibraryScopeSyncRevision: () => revisionState.value,
}));

import { useLiveSearchQuery } from './useLiveSearchQuery';

function buildingStatus(): SyncStateDto {
  return {
    serverId: 'srv-1',
    syncPhase: 'initial_sync',
    localTrackCount: 10,
    serverTrackCount: 1000,
  } as SyncStateDto;
}

function readyStatus(): SyncStateDto {
  return {
    serverId: 'srv-1',
    syncPhase: 'ready',
    localTrackCount: 1000,
    serverTrackCount: 1000,
  } as SyncStateDto;
}

function hookParams() {
  return {
    query: '',
    scope: null,
    shareMatch: null,
    liveSearchGenRef: { current: 0 },
    setResults: vi.fn(),
    setOpen: vi.fn(),
    setLoading: vi.fn(),
    setSearchSource: vi.fn(),
    setActiveIndex: vi.fn(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

describe('useLiveSearchQuery indexIncomplete', () => {
  beforeEach(() => {
    libraryGetStatusMock.mockReset();
    runLocalLiveSearchMock.mockReset().mockResolvedValue(null);
    raceLiveSearchMock.mockReset().mockResolvedValue(null);
    showToastMock.mockReset();
    subscribeLibrarySyncProgressMock.mockReset().mockResolvedValue(() => {});
    revisionState.value = 0;
    resetAuthStore();
    useAuthStore.setState({
      activeServerId: 'srv-1',
      servers: [{ id: 'srv-1', name: 'S', url: 'https://s.test', username: 'u', password: 'p' }],
      musicLibraryFilterVersion: 0,
    });
    useLibraryIndexStore.setState({ masterEnabled: true });
  });

  it('is true while the active server index is still building', async () => {
    libraryGetStatusMock.mockResolvedValue(buildingStatus());

    const { result } = renderHook(() => useLiveSearchQuery(hookParams()));

    await waitFor(() => expect(result.current.indexIncomplete).toBe(true));
    expect(libraryGetStatusMock).toHaveBeenCalledWith('s.test');
  });

  it('is false when the active server index is ready', async () => {
    libraryGetStatusMock.mockResolvedValue(readyStatus());

    const { result } = renderHook(() => useLiveSearchQuery(hookParams()));

    await waitFor(() => expect(result.current.indexIncomplete).toBe(false));
  });

  it('preserves the current multi-server search while one selected scope is still syncing', async () => {
    vi.useFakeTimers();
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
    libraryGetStatusMock.mockImplementation(async (serverId: string) => (
      serverId === 'b.test' ? buildingStatus() : readyStatus()
    ));
    const params = { ...hookParams(), query: 'metallica' };

    const { unmount } = renderHook(() => useLiveSearchQuery(params));
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();

    expect(params.setResults).not.toHaveBeenCalled();
    expect(params.setSearchSource).not.toHaveBeenCalled();
    expect(params.setLoading).not.toHaveBeenCalledWith(true);
    expect(runLocalLiveSearchMock).not.toHaveBeenCalled();
    expect(showToastMock).not.toHaveBeenCalled();
    unmount();
    vi.useRealTimers();
  });

  it('preserves the current multi-server search when readiness changes before the local read', async () => {
    vi.useFakeTimers();
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
    libraryGetStatusMock.mockResolvedValue(readyStatus());
    runLocalLiveSearchMock.mockResolvedValue(null);
    const params = { ...hookParams(), query: 'metallica' };

    const { unmount } = renderHook(() => useLiveSearchQuery(params));
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();

    expect(runLocalLiveSearchMock).toHaveBeenCalledOnce();
    expect(params.setResults).not.toHaveBeenCalled();
    expect(params.setSearchSource).not.toHaveBeenCalled();
    expect(params.setLoading).not.toHaveBeenCalledWith(true);
    expect(showToastMock).not.toHaveBeenCalled();
    unmount();
    vi.useRealTimers();
  });

  it('reruns the newest pending live query after the selected indexes become ready', async () => {
    vi.useFakeTimers();
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
    let bReady = true;
    libraryGetStatusMock.mockImplementation(async (serverId: string) => (
      serverId === 'b.test' && !bReady ? buildingStatus() : readyStatus()
    ));
    runLocalLiveSearchMock.mockImplementation(async (_serverId: string, query: string) => ({
      artists: [], albums: [], songs: [{
        id: query,
        title: query,
        artist: 'Artist',
        album: 'Album',
        albumId: 'album',
        duration: 60,
      }],
    }));
    const params = hookParams();
    const view = renderHook(
      ({ query }) => useLiveSearchQuery({ ...params, query }),
      { initialProps: { query: 'old' } },
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(runLocalLiveSearchMock).toHaveBeenCalledWith(
      'a',
      'old',
      expect.anything(),
      expect.objectContaining({ anchorServerId: 'a' }),
    );

    bReady = false;
    view.rerender({ query: 'new' });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(runLocalLiveSearchMock).not.toHaveBeenCalledWith(
      'a',
      'new',
      expect.anything(),
      expect.anything(),
    );

    bReady = true;
    revisionState.value += 1;
    view.rerender({ query: 'new' });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(runLocalLiveSearchMock).toHaveBeenCalledWith(
      'a',
      'new',
      expect.anything(),
      expect.objectContaining({ anchorServerId: 'a' }),
    );
    expect(params.setResults).toHaveBeenLastCalledWith(expect.objectContaining({
      songs: [expect.objectContaining({ id: 'new' })],
    }));
    view.unmount();
    vi.useRealTimers();
  });

  it('uses the selected browse anchor when the active server is not selected', async () => {
    vi.useFakeTimers();
    useAuthStore.setState({
      activeServerId: 'a',
      servers: [
        { id: 'a', name: 'A', url: 'https://a.test', username: 'u', password: 'p' },
        { id: 'b', name: 'B', url: 'https://b.test', username: 'u', password: 'p' },
      ],
      libraryBrowseServerIds: ['b'],
      musicFoldersByServer: { b: [{ id: 'lib-b', name: 'B' }] },
      libraryBrowseSelectionByServer: {},
    });
    libraryGetStatusMock.mockResolvedValue(readyStatus());
    runLocalLiveSearchMock.mockResolvedValue({ artists: [], albums: [], songs: [] });
    raceLiveSearchMock.mockImplementation(async (runLocal: () => Promise<SearchResults | null>) => {
      const result = await runLocal();
      return result ? { result, source: 'local', durationMs: 1 } : null;
    });
    const params = { ...hookParams(), query: 'metallica' };

    const { unmount } = renderHook(() => useLiveSearchQuery(params));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    expect(runLocalLiveSearchMock).toHaveBeenCalledWith(
      'b',
      'metallica',
      expect.anything(),
      expect.objectContaining({ anchorServerId: 'b' }),
    );
    unmount();
    vi.useRealTimers();
  });

  it('clears results from the previous scope when a newly selected owner is not ready', async () => {
    vi.useFakeTimers();
    useAuthStore.setState({
      activeServerId: 'a',
      servers: [
        { id: 'a', name: 'A', url: 'https://a.test', username: 'u', password: 'p' },
        { id: 'b', name: 'B', url: 'https://b.test', username: 'u', password: 'p' },
      ],
      libraryBrowseServerIds: ['a'],
      musicFoldersByServer: {
        a: [{ id: 'lib-a', name: 'A' }],
        b: [{ id: 'lib-b', name: 'B' }],
      },
      libraryBrowseSelectionByServer: {},
      libraryBrowseScopeVersion: 0,
    });
    libraryGetStatusMock.mockImplementation(async (serverId: string) => (
      serverId === 'b.test' ? buildingStatus() : readyStatus()
    ));
    const params = { ...hookParams(), query: 'metallica' };
    const view = renderHook(() => useLiveSearchQuery(params));

    useAuthStore.setState({
      libraryBrowseServerIds: ['a', 'b'],
      libraryBrowseScopeVersion: 1,
    });
    view.rerender();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    expect(params.setResults).toHaveBeenLastCalledWith({ artists: [], albums: [], songs: [] });
    view.unmount();
    vi.useRealTimers();
  });

  it('ignores a stale readiness response from the previous scope', async () => {
    const aStatus = deferred<SyncStateDto>();
    useAuthStore.setState({
      activeServerId: 'a',
      servers: [
        { id: 'a', name: 'A', url: 'https://a.test', username: 'u', password: 'p' },
        { id: 'b', name: 'B', url: 'https://b.test', username: 'u', password: 'p' },
      ],
      libraryBrowseServerIds: ['a'],
      musicFoldersByServer: {
        a: [{ id: 'lib-a', name: 'A' }],
        b: [{ id: 'lib-b', name: 'B' }],
      },
      libraryBrowseSelectionByServer: {},
      libraryBrowseScopeVersion: 0,
    });
    libraryGetStatusMock.mockImplementation((serverId: string) => (
      serverId === 'a.test' ? aStatus.promise : Promise.resolve(readyStatus())
    ));
    const params = hookParams();
    const view = renderHook(() => useLiveSearchQuery(params));

    useAuthStore.setState({ libraryBrowseServerIds: ['b'], libraryBrowseScopeVersion: 1 });
    view.rerender();
    await waitFor(() => expect(libraryGetStatusMock).toHaveBeenCalledWith('b.test'));
    await waitFor(() => expect(view.result.current.indexIncomplete).toBe(false));

    await act(async () => { aStatus.resolve(buildingStatus()); });
    expect(view.result.current.indexIncomplete).toBe(false);
  });

  it('unsubscribes a progress listener whose registration resolves after cleanup', async () => {
    const firstRegistration = deferred<() => void>();
    const staleUnlisten = vi.fn();
    subscribeLibrarySyncProgressMock
      .mockReturnValueOnce(firstRegistration.promise)
      .mockResolvedValueOnce(() => {});
    libraryGetStatusMock.mockResolvedValue(readyStatus());
    useAuthStore.setState({
      activeServerId: 'a',
      servers: [
        { id: 'a', name: 'A', url: 'https://a.test', username: 'u', password: 'p' },
        { id: 'b', name: 'B', url: 'https://b.test', username: 'u', password: 'p' },
      ],
      libraryBrowseServerIds: ['a'],
      musicFoldersByServer: {
        a: [{ id: 'lib-a', name: 'A' }],
        b: [{ id: 'lib-b', name: 'B' }],
      },
      libraryBrowseSelectionByServer: {},
      libraryBrowseScopeVersion: 0,
    });
    const view = renderHook(() => useLiveSearchQuery(hookParams()));
    await waitFor(() => expect(subscribeLibrarySyncProgressMock).toHaveBeenCalledTimes(1));

    useAuthStore.setState({ libraryBrowseServerIds: ['b'], libraryBrowseScopeVersion: 1 });
    view.rerender();
    await waitFor(() => expect(subscribeLibrarySyncProgressMock).toHaveBeenCalledTimes(2));

    await act(async () => { firstRegistration.resolve(staleUnlisten); });
    expect(staleUnlisten).toHaveBeenCalledOnce();
  });
});

describe('live Octo catalog search', () => {
  it('contacts a selected proxy while the local multi-server index is incomplete', async () => {
    vi.useFakeTimers();
    resetAuthStore();
    useAuthStore.setState({
      activeServerId: 'a',
      servers: [
        { id: 'a', name: 'A', url: 'https://a.test', username: 'u', password: 'p' },
        { id: 'b', name: 'B', url: 'https://b.test', username: 'u', password: 'p' },
      ],
      libraryBrowseServerIds: ['a', 'b'],
      openSubsonicExtensionsByServer: { b: ['octoAcquisitions'] },
    });
    useLibraryIndexStore.setState({ masterEnabled: true });
    libraryGetStatusMock.mockResolvedValue(buildingStatus());
    const remote = { artists: [], albums: [], songs: [] };
    runNetworkLiveSearchMock.mockResolvedValue(remote);
    raceLiveSearchMock.mockImplementation(async (_local, network) => ({ result: await network(), source: 'network', durationMs: 0 }));
    const params = { ...hookParams(), query: 'outside artist' };
    const view = renderHook(() => useLiveSearchQuery(params));
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(runNetworkLiveSearchMock).toHaveBeenCalledWith('outside artist', expect.anything(), 'b', 30000, 20);
      expect(params.setResults).toHaveBeenLastCalledWith(remote);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });
});
