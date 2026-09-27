import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSmartCoverCollage } from './useSmartCoverCollage';

const getPlaylistForServerMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/subsonicPlaylists', () => ({
  getPlaylistForServer: getPlaylistForServerMock,
}));

vi.mock('@/lib/api/subsonicLibrary', () => ({
  filterSongsToServerLibrary: (songs: unknown[]) => Promise.resolve(songs),
}));

describe('useSmartCoverCollage', () => {
  it('builds a collage for legacy smart playlists but keeps native ones on their server cover', async () => {
    getPlaylistForServerMock.mockImplementation(async (_serverId: string, id: string) => ({
      playlist: { id },
      songs: [{ id: `${id}-1`, coverArt: `${id}-cover` }],
    }));

    const playlists = [
      { id: 'legacy', serverId: 'a', name: 'psy-smart-Legacy mix', songCount: 1, duration: 10, created: '', changed: '' },
      {
        id: 'native', serverId: 'a', name: 'Native mix', smart: true, coverArt: 'pl-native',
        songCount: 1, duration: 10, created: '', changed: '',
      },
    ];
    const { result } = renderHook(() => useSmartCoverCollage(playlists, 0));

    await waitFor(() => expect(result.current).toEqual({ 'a:legacy': ['legacy-cover'] }));
    expect(getPlaylistForServerMock).toHaveBeenCalledTimes(1);
    expect(getPlaylistForServerMock).toHaveBeenCalledWith('a', 'legacy');
  });
});
