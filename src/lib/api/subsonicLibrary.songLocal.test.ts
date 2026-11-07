/**
 * `getSongForServer` skips the server for a track that plays from local bytes
 * (download or hot cache) — except when the caller asks for server metadata
 * explicitly (`evenIfLocal`, Song Info). Uses the real network guard; only the
 * local-bytes lookup and reachability are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiForServerMock, localBytes } = vi.hoisted(() => ({
  apiForServerMock: vi.fn(),
  localBytes: { has: true },
}));

vi.mock('@/lib/api/subsonicClient', () => ({
  api: vi.fn(),
  apiForServer: apiForServerMock,
  libraryFilterParams: () => ({}),
  libraryFilterParamsForServer: () => ({}),
  librarySelectionForServer: () => [],
}));
vi.mock('@/store/localPlaybackResolve', () => ({
  hasLocalPlaybackUrl: () => localBytes.has,
}));
vi.mock('@/lib/network/activeServerReachability', () => ({
  isActiveServerReachable: () => true,
}));
vi.mock('@/lib/network/navigatorOnlineHint', () => ({
  isNavigatorOfflineHint: () => false,
}));
vi.mock('@/store/devOfflineBrowseStore', () => ({
  isDevOfflineBrowseForced: () => false,
}));
vi.mock('@/lib/library/luckyMixScopeOverride', () => ({
  getLuckyMixLibraryScopeOverride: () => null,
}));
vi.mock('@/lib/library/patchOnUse', () => ({
  mirrorAlbumMetadataFromServerOnUse: vi.fn(),
}));

import { getSongForServer } from '@/lib/api/subsonicLibrary';

const song = { id: 'song-1', title: 'Song', artist: 'Artist', album: 'Album', albumId: 'album-1', duration: 30 };

describe('getSongForServer and local bytes', () => {
  beforeEach(() => {
    apiForServerMock.mockReset();
    apiForServerMock.mockResolvedValue({ song });
    localBytes.has = true;
  });

  it('skips the server for a local track by default', async () => {
    await expect(getSongForServer('srv-1', 'song-1')).resolves.toBeNull();
    expect(apiForServerMock).not.toHaveBeenCalled();
  });

  it('asks the server for a local track when the caller wants server metadata', async () => {
    await expect(getSongForServer('srv-1', 'song-1', { evenIfLocal: true }))
      .resolves.toEqual({ ...song, serverId: 'srv-1' });
    expect(apiForServerMock).toHaveBeenCalledWith('srv-1', 'getSong.view', { id: 'song-1' });
  });

  it('asks the server for a track that is not local either way', async () => {
    localBytes.has = false;
    await expect(getSongForServer('srv-1', 'song-1')).resolves.toEqual({ ...song, serverId: 'srv-1' });
  });
});
