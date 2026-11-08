// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubsonicArtist } from '@/lib/api/subsonicTypes';
import type { ArtistCatalogChunkResult } from '@/lib/library/browseTextSearch';

const mocks = vi.hoisted(() => ({
  fetchLocalArtistCatalogChunk: vi.fn(),
}));

vi.mock('@/lib/library/browseTextSearch', () => ({
  fetchLocalArtistCatalogChunk: mocks.fetchLocalArtistCatalogChunk,
}));
vi.mock('@/features/artist/utils/artistBrowseCreditMode', () => ({
  fetchNetworkArtistCatalog: vi.fn(async () => []),
  fetchStarredArtistsForBrowse: vi.fn(async () => []),
}));
vi.mock('@/lib/library/starredArtistIndexSync', () => ({
  refreshStarredArtistIndexes: vi.fn(async () => {}),
}));
vi.mock('@/features/offline', () => ({
  fetchOfflineLocalArtistCatalogChunk: vi.fn(async () => null),
  fetchOfflineLocalStarredArtists: vi.fn(async () => []),
  offlineLocalBrowseEnabled: vi.fn(() => false),
  useOfflineBrowseContext: () => ({ active: false }),
  useOfflineBrowseReloadToken: () => 0,
}));
vi.mock('@/store/localPlaybackBrowseRevision', () => ({
  useOfflineLocalBrowseReloadKey: () => 0,
}));

import {
  useArtistsBrowseCatalog,
  type UseArtistsBrowseCatalogArgs,
} from '@/features/artist/hooks/useArtistsBrowseCatalog';
import { clearArtistBrowseCatalogCache } from '@/lib/library/artistBrowseInflight';
import {
  bumpOfflineLocalLibrarySyncRevisionForTests,
  resetOfflineLocalLibrarySyncRevisionForTests,
} from '@/store/offlineLocalLibrarySyncRevision';

function artists(...ids: string[]): SubsonicArtist[] {
  return ids.map(id => ({ id, name: id })) as SubsonicArtist[];
}

const args: UseArtistsBrowseCatalogArgs = {
  serverId: 'srv-1',
  indexEnabled: true,
  starredOnly: false,
  creditMode: 'album',
  letterFilter: 'ALL',
  musicLibraryFilterVersion: 0,
  libraryScopeKey: 'srv-1',
  libraryScopes: [{ serverId: 'srv-1', libraryId: null }],
  multiServer: false,
};

async function renderLoaded(props: UseArtistsBrowseCatalogArgs = args) {
  const hook = renderHook((p: UseArtistsBrowseCatalogArgs) => useArtistsBrowseCatalog(p), {
    initialProps: props,
  });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.catalogArtists.map(a => a.id)).toEqual(['a', 'b']);
  return hook;
}

beforeEach(() => {
  clearArtistBrowseCatalogCache();
  resetOfflineLocalLibrarySyncRevisionForTests();
  mocks.fetchLocalArtistCatalogChunk
    .mockReset()
    .mockResolvedValue({ artists: artists('a', 'b'), hasMore: false });
});

describe('useArtistsBrowseCatalog on a library sync tick', () => {
  it('keeps the list on screen while the refreshed catalog loads', async () => {
    const { result } = await renderLoaded();

    let resolveRefresh!: (chunk: ArtistCatalogChunkResult) => void;
    mocks.fetchLocalArtistCatalogChunk.mockReturnValueOnce(
      new Promise<ArtistCatalogChunkResult>(resolve => { resolveRefresh = resolve; }),
    );
    act(() => bumpOfflineLocalLibrarySyncRevisionForTests('srv-1'));

    expect(result.current.loading).toBe(false);
    expect(result.current.catalogArtists.map(a => a.id)).toEqual(['a', 'b']);

    await act(async () => resolveRefresh({ artists: artists('a', 'new', 'b'), hasMore: false }));
    expect(result.current.catalogArtists.map(a => a.id)).toEqual(['a', 'new', 'b']);
    expect(result.current.loading).toBe(false);
  });

  it('keeps the list when the refresh fails', async () => {
    const { result } = await renderLoaded();

    mocks.fetchLocalArtistCatalogChunk.mockResolvedValueOnce(null);
    await act(async () => bumpOfflineLocalLibrarySyncRevisionForTests('srv-1'));

    expect(result.current.catalogArtists.map(a => a.id)).toEqual(['a', 'b']);
    expect(result.current.loading).toBe(false);
  });

  it('refreshes the starred list without emptying it', async () => {
    const { result } = await renderLoaded({ ...args, starredOnly: true });

    mocks.fetchLocalArtistCatalogChunk.mockResolvedValue({ artists: artists('b'), hasMore: false });
    act(() => bumpOfflineLocalLibrarySyncRevisionForTests('srv-1'));
    expect(result.current.catalogArtists.map(a => a.id)).toEqual(['a', 'b']);

    await waitFor(() => expect(result.current.catalogArtists.map(a => a.id)).toEqual(['b']));
    expect(mocks.fetchLocalArtistCatalogChunk).toHaveBeenLastCalledWith(
      'srv-1',
      0,
      10_000,
      'album',
      undefined,
      expect.objectContaining({ starredOnly: true }),
    );
  });

  it('still starts over when the view itself changes', async () => {
    const { result, rerender } = await renderLoaded();

    mocks.fetchLocalArtistCatalogChunk.mockReturnValueOnce(new Promise(() => {}));
    rerender({ ...args, letterFilter: 'B' });

    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.catalogArtists).toEqual([]);
  });
});
