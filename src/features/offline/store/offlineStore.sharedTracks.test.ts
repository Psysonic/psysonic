import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { useAuthStore } from '@/store/authStore';
import { localPlaybackPinSources, useLocalPlaybackStore } from '@/store/localPlaybackStore';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { invokeMock, onInvoke } from '@/test/mocks/tauri';
import { cancelledDownloads, useOfflineJobStore } from '@/features/offline/store/offlineJobStore';
import { clearOfflinePinTasks } from '@/features/offline/utils/offlinePinQueue';
import { isOfflinePinComplete } from '@/features/offline/utils/offlineLibraryHelpers';

vi.mock('@/lib/api/subsonicStreamUrl', () => ({
  buildOriginalStreamUrlForServer: (serverId: string, trackId: string) => `https://original.test/${serverId}/${trackId}`,
}));
vi.mock('@/lib/api/library', () => ({ libraryUpsertSongsFromApi: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/subsonicLibrary', () => ({ getAlbumForServer: vi.fn() }));
vi.mock('@/lib/api/subsonicArtists', () => ({ getArtistForServer: vi.fn() }));

import { useOfflineStore } from '@/features/offline/store/offlineStore';

const song = (id: string): SubsonicSong => ({
  id, title: id, artist: 'Artist', album: 'Album', albumId: 'album-1', duration: 180, suffix: 'flac',
});

const ALBUM_TRACK_PATH = '/media/library/a.test/track-1.flac';

beforeEach(() => {
  resetAuthStore();
  clearOfflinePinTasks();
  cancelledDownloads.clear();
  useOfflineStore.setState({ albums: {} });
  useOfflineJobStore.setState({ jobs: [], pinQueue: [], bulkProgress: {} });
  useLocalPlaybackStore.setState({ entries: {} });
  useAuthStore.setState({
    activeServerId: 'srv-a',
    servers: [{ id: 'srv-a', name: 'A', url: 'https://a.test', username: 'u', password: 'p' }],
  });
  invokeMock.mockClear();
  onInvoke('download_track_local', args => ({
    path: `/media/library/a.test/${(args as { trackId: string }).trackId}.flac`,
    size: 456,
    layoutFingerprint: 'layout',
    originalBytesVerified: true,
  }));
  onInvoke('clear_offline_cancel', () => undefined);
  onInvoke('cancel_offline_downloads', () => undefined);
  onInvoke('delete_media_file', () => ({ status: 'ok', data: null }));
  // Track 1 is already on disk through the album's pin.
  useLocalPlaybackStore.getState().upsertEntry({
    serverIndexKey: 'a.test',
    trackId: 'track-1',
    localPath: ALBUM_TRACK_PATH,
    sizeBytes: 123,
    layoutFingerprint: 'layout',
    tier: 'library',
    pinSource: { kind: 'album', sourceId: 'album-1' },
    suffix: 'flac',
    originalBytesVerified: true,
  });
});

async function cachePlaylistWithOneAlbumTrack() {
  await useOfflineStore.getState().downloadPlaylist(
    'pl-1', 'Mix', undefined, [song('track-1'), song('track-2')], 'srv-a',
  );
  await waitFor(() => expect(useOfflineJobStore.getState().pinQueue).toEqual([]));
}

describe('a playlist sharing tracks with a downloaded album', () => {
  it('takes the album\'s tracks into the playlist pin and loads only the rest', async () => {
    await cachePlaylistWithOneAlbumTrack();

    const shared = useLocalPlaybackStore.getState().getEntry('track-1', 'a.test');
    expect(localPlaybackPinSources(shared!)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'album', sourceId: 'album-1' }),
      expect.objectContaining({ kind: 'playlist', sourceId: 'pl-1' }),
    ]));
    const downloads = invokeMock.mock.calls.filter(([command]) => command === 'download_track_local');
    expect(downloads.map(([, args]) => (args as { trackId: string }).trackId)).toEqual(['track-2']);
    expect(isOfflinePinComplete('pl-1', 'srv-a', ['track-1', 'track-2'], { kind: 'playlist', sourceId: 'pl-1' }))
      .toBe(true);
  });

  it('keeps the shared track for the playlist when the album is removed', async () => {
    await cachePlaylistWithOneAlbumTrack();
    invokeMock.mockClear();

    await useOfflineStore.getState().deleteAlbum('album-1', 'srv-a', { kind: 'album', sourceId: 'album-1' });

    const shared = useLocalPlaybackStore.getState().getEntry('track-1', 'a.test');
    expect(shared?.localPath).toBe(ALBUM_TRACK_PATH);
    expect(localPlaybackPinSources(shared!)).toEqual([
      expect.objectContaining({ kind: 'playlist', sourceId: 'pl-1' }),
    ]);
    const deletes = invokeMock.mock.calls.filter(([command]) => command === 'delete_media_file');
    expect(deletes).toEqual([]);
  });
});
