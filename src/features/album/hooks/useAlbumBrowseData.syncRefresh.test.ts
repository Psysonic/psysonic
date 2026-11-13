import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';
import type { AlbumBrowsePageResult } from '@/lib/library/albumBrowseTypes';

const mocks = vi.hoisted(() => ({
  fetchLocalAlbumCatalogChunk: vi.fn(),
}));

vi.mock('@/lib/library/albumBrowseLoad', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/library/albumBrowseLoad')>()),
  fetchLocalAlbumCatalogChunk: mocks.fetchLocalAlbumCatalogChunk,
  fetchAlbumBrowseGenreOptions: vi.fn(async () => []),
}));
vi.mock('@/lib/library/libraryBrowseScope', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/library/libraryBrowseScope')>()),
  getLibraryBrowseScope: () => ({ serverIds: ['srv-1'], pairs: [] }),
}));
vi.mock('@/features/offline', () => ({
  fetchOfflineLocalAlbumGenreOptions: vi.fn(async () => []),
  isOfflineBrowseActive: () => false,
  loadOfflineAlbumBrowseInitial: vi.fn(),
  loadOfflineAlbumCatalogChunk: vi.fn(),
  offlineLocalBrowseEnabled: () => false,
  useOfflineBrowseContext: () => ({ active: false }),
  useOfflineBrowseReloadToken: () => 0,
}));
vi.mock('@/store/localPlaybackBrowseRevision', () => ({
  useOfflineLocalBrowseReloadKey: () => 0,
}));

import { useAlbumBrowseData, type UseAlbumBrowseDataArgs } from '@/features/album/hooks/useAlbumBrowseData';
import { clearAlbumBrowseCatalogCache } from '@/lib/library/albumBrowseInflight';
import {
  bumpOfflineLocalLibrarySyncRevisionForTests,
  resetOfflineLocalLibrarySyncRevisionForTests,
} from '@/store/offlineLocalLibrarySyncRevision';

function albums(...ids: string[]): SubsonicAlbum[] {
  return ids.map(id => ({ id, name: id, artist: 'Artist', artistId: 'art-1' })) as SubsonicAlbum[];
}

const noGenres: string[] = [];
const noOverrides: Record<string, boolean> = {};
const args: UseAlbumBrowseDataArgs = {
  serverId: 'srv-1',
  indexEnabled: true,
  musicLibraryFilterVersion: 0,
  sort: 'alphabeticalByName',
  selectedGenres: noGenres,
  yearFrom: '',
  yearTo: '',
  losslessOnly: false,
  starredOnly: false,
  compFilter: 'all',
  starredOverrides: noOverrides,
};

async function renderLoaded() {
  const hook = renderHook((props: UseAlbumBrowseDataArgs) => useAlbumBrowseData(props), {
    initialProps: args,
  });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.albums.map(a => a.id)).toEqual(['a', 'b']);
  return hook;
}

beforeEach(() => {
  clearAlbumBrowseCatalogCache();
  resetOfflineLocalLibrarySyncRevisionForTests();
  mocks.fetchLocalAlbumCatalogChunk
    .mockReset()
    .mockResolvedValue({ albums: albums('a', 'b'), hasMore: false });
});

describe('useAlbumBrowseData on a library sync tick', () => {
  it('keeps the list on screen while the refreshed catalog loads', async () => {
    const { result } = await renderLoaded();

    let resolveRefresh!: (page: AlbumBrowsePageResult) => void;
    mocks.fetchLocalAlbumCatalogChunk.mockReturnValueOnce(
      new Promise<AlbumBrowsePageResult>(resolve => { resolveRefresh = resolve; }),
    );
    act(() => bumpOfflineLocalLibrarySyncRevisionForTests('srv-1'));

    // Emptying the list here is what sends the scroll position back to the top.
    expect(result.current.loading).toBe(false);
    expect(result.current.albums.map(a => a.id)).toEqual(['a', 'b']);

    await act(async () => resolveRefresh({ albums: albums('a', 'new', 'b'), hasMore: false }));
    expect(result.current.albums.map(a => a.id)).toEqual(['a', 'new', 'b']);
    expect(result.current.loading).toBe(false);
  });

  it('keeps the list when the refresh fails', async () => {
    const { result } = await renderLoaded();

    mocks.fetchLocalAlbumCatalogChunk.mockResolvedValueOnce(null);
    await act(async () => bumpOfflineLocalLibrarySyncRevisionForTests('srv-1'));

    expect(result.current.albums.map(a => a.id)).toEqual(['a', 'b']);
    expect(result.current.loading).toBe(false);
  });

  it('still starts over when the view itself changes', async () => {
    const { result, rerender } = await renderLoaded();

    mocks.fetchLocalAlbumCatalogChunk.mockReturnValueOnce(new Promise(() => {}));
    rerender({ ...args, sort: 'alphabeticalByArtist' });

    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.albums).toEqual([]);
  });
});
