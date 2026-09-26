import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePlaylistsLibraryScopeCounts } from './usePlaylistsLibraryScopeCounts';

const getPlaylistForServerMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/subsonicPlaylists', () => ({
  getPlaylistForServer: getPlaylistForServerMock,
}));

vi.mock('@/lib/api/subsonicLibrary', () => ({
  filterSongsToServerLibrary: (songs: unknown[]) => Promise.resolve(songs),
}));

vi.mock('@/features/offline', () => ({
  useOfflineBrowseContext: () => ({ active: false }),
}));

describe('usePlaylistsLibraryScopeCounts', () => {
  it('keeps matching playlist ids distinct across servers', async () => {
    getPlaylistForServerMock.mockImplementation(async (serverId: string) => ({
      playlist: { id: 'same' },
      songs: serverId === 'a'
        ? [{ id: 'a1', duration: 10 }]
        : [{ id: 'b1', duration: 20 }, { id: 'b2', duration: 30 }],
    }));

    const { result } = renderHook(() => usePlaylistsLibraryScopeCounts([
      { id: 'same', serverId: 'a', name: 'A', songCount: 1, duration: 10, created: '', changed: '' },
      { id: 'same', serverId: 'b', name: 'B', songCount: 2, duration: 50, created: '', changed: '' },
    ], 0));

    await waitFor(() => expect(result.current.filteredSongCountByPlaylist).toEqual({
      'a:same': 1,
      'b:same': 2,
    }));
    expect(result.current.filteredDurationByPlaylist).toEqual({
      'a:same': 10,
      'b:same': 50,
    });
  });
});
