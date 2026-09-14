import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';

const mocks = vi.hoisted(() => ({
  resolveAlbum: vi.fn(),
  resolveArtist: vi.fn(),
  libraryIsReady: vi.fn(),
}));

vi.mock('@/features/offline', () => ({
  resolveAlbum: mocks.resolveAlbum,
  resolveArtist: mocks.resolveArtist,
  loadAlbumFromLibraryIndex: vi.fn(async () => null),
  loadArtistFromLibraryIndex: vi.fn(async () => null),
  loadArtistFromLocalPlayback: vi.fn(async () => null),
  offlineLocalBrowseEnabled: () => false,
  useOfflineBrowseContext: () => ({ active: false }),
}));
vi.mock('@/lib/library/libraryReady', () => ({ libraryIsReady: mocks.libraryIsReady }));
vi.mock('@/lib/library/libraryBrowseScope', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/library/libraryBrowseScope')>()),
  getLibraryBrowseScope: () => ({ serverIds: ['srv-1'], pairs: [] }),
  hasConfiguredLibraryBrowseScope: () => false,
}));
vi.mock('@/lib/navigation/detailServerScope', () => ({ readDetailServerId: () => 'srv-1' }));
vi.mock('@/lib/network/subsonicNetworkGuard', () => ({
  shouldAttemptSubsonicForServer: () => true,
  shouldAttemptSubsonicForActiveServer: () => true,
}));
vi.mock('react-router', () => ({ useSearchParams: () => [new URLSearchParams(), vi.fn()] }));

import { useAlbumDetailData } from '@/features/album/hooks/useAlbumDetailData';
import {
  bumpOfflineLocalLibrarySyncRevisionForTests,
  resetOfflineLocalLibrarySyncRevisionForTests,
} from '@/store/offlineLocalLibrarySyncRevision';

function album(name: string): { album: SubsonicAlbum; songs: [] } {
  return {
    album: { id: 'alb-1', name, artist: 'Artist', artistId: 'art-1', serverId: 'srv-1' } as SubsonicAlbum,
    songs: [],
  };
}

beforeEach(() => {
  resetOfflineLocalLibrarySyncRevisionForTests();
  mocks.resolveAlbum.mockReset().mockResolvedValue(album('First load'));
  mocks.resolveArtist.mockReset().mockResolvedValue(null);
  mocks.libraryIsReady.mockReset().mockResolvedValue(true);
});

describe('useAlbumDetailData on a library sync tick', () => {
  it('keeps the album on screen instead of blanking the page', async () => {
    const { result } = renderHook(() => useAlbumDetailData('alb-1'));
    await waitFor(() => expect(result.current.album?.album.name).toBe('First load'));
    expect(result.current.loading).toBe(false);

    // A background sync completing is not a navigation: the page must not fall
    // back to its empty loading state (the visible "reload" in issue terms).
    mocks.resolveAlbum.mockResolvedValue(album('Refreshed'));
    act(() => bumpOfflineLocalLibrarySyncRevisionForTests('srv-1'));

    expect(result.current.album).not.toBeNull();
    expect(result.current.loading).toBe(false);

    // …and the refreshed payload still lands once it resolves.
    await waitFor(() => expect(result.current.album?.album.name).toBe('Refreshed'));
  });

  it('still clears the view when the album actually changes', async () => {
    const { result, rerender } = renderHook(({ id }) => useAlbumDetailData(id), {
      initialProps: { id: 'alb-1' },
    });
    await waitFor(() => expect(result.current.album?.album.name).toBe('First load'));

    let resolveSecond!: (value: unknown) => void;
    mocks.resolveAlbum.mockReturnValue(new Promise(resolve => { resolveSecond = resolve; }));
    rerender({ id: 'alb-2' });

    // Navigating away must not leave the previous album's tracks on screen.
    expect(result.current.album).toBeNull();
    expect(result.current.loading).toBe(true);

    resolveSecond(album('Second album'));
    await waitFor(() => expect(result.current.album?.album.name).toBe('Second album'));
  });
});
