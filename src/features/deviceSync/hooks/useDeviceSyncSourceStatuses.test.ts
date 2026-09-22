import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/playback/utils/playback/fetchTracksForSource');
vi.mock('@/lib/api/syncfs');

import { fetchTracksForSource } from '@/features/playback/utils/playback/fetchTracksForSource';
import { computeSyncPaths } from '@/lib/api/syncfs';
import { makeSubsonicSong } from '@/test/helpers/factories';
import { deviceSyncSourceKey, type DeviceSyncSource } from '@/features/deviceSync/store/deviceSyncStore';
import { useDeviceSyncSourceStatuses } from './useDeviceSyncSourceStatuses';

describe('useDeviceSyncSourceStatuses', () => {
  it('uses album metadata precedence for shared playlist tracks', async () => {
    const album: DeviceSyncSource = {
      type: 'album', id: 'album-1', name: 'Album', serverIndexKey: 'server.test',
    };
    const playlist: DeviceSyncSource = {
      type: 'playlist', id: 'playlist-1', name: 'Mix', serverIndexKey: 'server.test',
    };
    const albumTrack = makeSubsonicSong({
      id: 'track-1', albumArtist: 'Canonical Artist', album: 'Canonical Album', title: 'Song', track: 1,
    });
    const playlistTrack = makeSubsonicSong({
      id: 'track-1', albumArtist: 'Playlist Artist', album: 'Playlist Album', title: 'Song', track: 1,
    });
    vi.mocked(fetchTracksForSource).mockImplementation(async source => (
      source.type === 'album' ? [albumTrack] : [playlistTrack]
    ));
    vi.mocked(computeSyncPaths).mockImplementation(async ({ tracks }) => tracks.map(track => (
      `/device/${track.albumArtist}/${track.album}/01 - ${track.title}.flac`
    )));

    const { result } = renderHook(() => useDeviceSyncSourceStatuses(
      '/device',
      [album, playlist],
      [],
      ['/device/Canonical Artist/Canonical Album/01 - Song.flac'],
      'shared-album-tree',
      false,
    ));

    await waitFor(() => expect(result.current.sourceStatuses.get(deviceSyncSourceKey(playlist))).toBe('synced'));
    expect(result.current.sourcePathsMap.get(deviceSyncSourceKey(playlist))).toEqual([
      '/device/Canonical Artist/Canonical Album/01 - Song.flac',
    ]);
  });

  it('asks for flat paths without playlist folders in the flat layout', async () => {
    const playlist: DeviceSyncSource = {
      type: 'playlist', id: 'playlist-1', name: 'Mix', serverIndexKey: 'server.test',
    };
    const song = makeSubsonicSong({
      id: 'track-1', albumArtist: 'Artist', album: 'Album', title: 'Song', track: 1,
    });
    vi.mocked(fetchTracksForSource).mockResolvedValue([song]);
    vi.mocked(computeSyncPaths).mockClear();
    vi.mocked(computeSyncPaths).mockImplementation(async ({ tracks }) => tracks.map(track => (
      track.flatLayout
        ? `/device/${track.albumArtist} - ${track.album} - 01 - ${track.title}.flac`
        : `/device/Playlists/${track.playlistName}/01 - ${track.title}.flac`
    )));

    const { result } = renderHook(() => useDeviceSyncSourceStatuses(
      '/device',
      [playlist],
      [],
      ['/device/Artist - Album - 01 - Song.flac'],
      'flat',
      false,
    ));

    await waitFor(() => expect(result.current.sourceStatuses.get(deviceSyncSourceKey(playlist))).toBe('synced'));
    const [{ tracks }] = vi.mocked(computeSyncPaths).mock.calls[0]!;
    expect(tracks[0]).toMatchObject({ flatLayout: true });
    expect(tracks[0]?.playlistName).toBeUndefined();
  });
});
