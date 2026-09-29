import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, loginMock, getServerByIdMock, connectBaseUrlMock, authState } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  loginMock: vi.fn(),
  getServerByIdMock: vi.fn(),
  connectBaseUrlMock: vi.fn(),
  authState: {
    activeServerId: 'srv-a' as string | null,
    servers: [] as Array<{ id: string; url: string }>,
  },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@/lib/api/navidromeAdmin', () => ({ ndLogin: loginMock }));
vi.mock('@/lib/api/subsonicClient', () => ({
  getServerById: getServerByIdMock,
  librarySelectionForServer: () => [],
}));
vi.mock('@/lib/server/serverEndpoint', () => ({ connectBaseUrlForServer: connectBaseUrlMock }));
vi.mock('@/store/authStore', () => ({
  useAuthStore: { getState: () => authState },
}));

import {
  ndClearTokenCache,
  ndListAlbumsByArtistRoleForServer,
  ndListAlbumsByTagForServer,
  ndListArtistsByRoleForServer,
  ndListLosslessAlbumsPage,
  ndListLosslessAlbumsPageForServer,
  ndListTagsForServer,
} from '@/lib/api/navidromeBrowse';

const servers = {
  'srv-a': { id: 'srv-a', url: 'https://a.example', username: 'alice', password: 'a-pass' },
  'srv-b': { id: 'srv-b', url: 'https://b.example', username: 'bob', password: 'b-pass' },
};

describe('explicit-server lossless album browsing', () => {
  beforeEach(() => {
    ndClearTokenCache();
    authState.activeServerId = 'srv-a';
    authState.servers = Object.values(servers);
    invokeMock.mockReset();
    loginMock.mockReset();
    getServerByIdMock.mockReset();
    connectBaseUrlMock.mockReset();
    getServerByIdMock.mockImplementation((serverId: keyof typeof servers) => servers[serverId]);
    connectBaseUrlMock.mockImplementation((server: { id: string }) => `https://${server.id}.connect`);
    loginMock.mockImplementation(async (serverUrl: string) => ({ token: `token:${serverUrl}`, userId: 'u', isAdmin: false }));
    invokeMock.mockResolvedValue([]);
  });

  it('resolves explicit profiles, caches tokens per server, and stamps albums', async () => {
    invokeMock.mockImplementation(async (_command: string, args: { serverUrl: string }) => [{
      id: `song:${args.serverUrl}`,
      albumId: 'shared-album-id',
      album: `Album ${args.serverUrl}`,
      albumArtist: 'Artist',
      albumArtistId: 'artist-1',
      coverArtId: 'cover-1',
      bitDepth: 24,
      sampleRate: 96000,
      suffix: 'flac',
    }]);

    const request = { targetNewAlbums: 1, songsPerPage: 10, maxPagesPerCall: 1 };
    const firstA = await ndListLosslessAlbumsPageForServer('srv-a', request);
    const pageB = await ndListLosslessAlbumsPageForServer('srv-b', request);
    await ndListLosslessAlbumsPageForServer('srv-a', request);

    expect(firstA.entries[0]?.album.serverId).toBe('a.example');
    expect(pageB.entries[0]?.album.serverId).toBe('b.example');
    expect(loginMock).toHaveBeenCalledTimes(2);
    expect(loginMock).toHaveBeenCalledWith('https://srv-a.connect', 'alice', 'a-pass');
    expect(loginMock).toHaveBeenCalledWith('https://srv-b.connect', 'bob', 'b-pass');
    expect(invokeMock).toHaveBeenCalledWith('nd_list_songs', expect.objectContaining({
      serverUrl: 'https://srv-b.connect',
      token: 'token:https://srv-b.connect',
    }));
  });

  it('keeps the active-server wrapper and clear-cache semantics', async () => {
    const request = { targetNewAlbums: 1, maxPagesPerCall: 1 };

    await ndListLosslessAlbumsPage(request);
    await ndListLosslessAlbumsPage(request);
    expect(loginMock).toHaveBeenCalledTimes(1);

    ndClearTokenCache();
    await ndListLosslessAlbumsPage(request);
    expect(loginMock).toHaveBeenCalledTimes(2);
    expect(getServerByIdMock).toHaveBeenCalledWith('srv-a');
  });

  it('routes composer role reads through the requested server', async () => {
    invokeMock
      .mockResolvedValueOnce([{ id: 'composer-1', name: 'Composer', stats: { composer: { albumCount: 2 } } }])
      .mockResolvedValueOnce([{ id: 'album-1', name: 'Work', albumArtist: 'Performer' }]);

    const composers = await ndListArtistsByRoleForServer('srv-b', 'composer', 0, 100, 'name', 'ASC', 'lib-b');
    const albums = await ndListAlbumsByArtistRoleForServer(
      'srv-b', 'composer-1', 'composer', 0, 100, 'name', 'ASC', 'lib-b',
    );

    expect(composers[0]).toEqual(expect.objectContaining({ id: 'composer-1', serverId: 'b.example', albumCount: 2 }));
    expect(albums[0]).toEqual(expect.objectContaining({ id: 'album-1', serverId: 'b.example' }));
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'nd_list_artists_by_role', expect.objectContaining({
      serverUrl: 'https://srv-b.connect',
      token: 'token:https://srv-b.connect',
      libraryId: 'lib-b',
    }));
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'nd_list_albums_by_artist_role', expect.objectContaining({
      serverUrl: 'https://srv-b.connect',
      artistId: 'composer-1',
      libraryId: 'lib-b',
    }));
  });

  it('lists tag values and drops rows without an id', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: 'tag-1', tagName: 'recordlabel', tagValue: '4AD' },
      { tagName: 'recordlabel', tagValue: 'orphan' },
    ]);

    const tags = await ndListTagsForServer('srv-b', 'recordlabel', '4A');

    expect(tags).toEqual([{ id: 'tag-1', value: '4AD' }]);
    expect(invokeMock).toHaveBeenCalledWith('nd_list_tags', expect.objectContaining({
      serverUrl: 'https://srv-b.connect',
      token: 'token:https://srv-b.connect',
      tagName: 'recordlabel',
      tagValue: '4A',
    }));
  });

  it('pages albums by tag with the server total and retries once on 401', async () => {
    invokeMock
      .mockRejectedValueOnce(new Error('HTTP 401 Unauthorized'))
      .mockResolvedValueOnce({ items: [{ id: 'album-1', name: 'Bright Future', albumArtist: 'Adrianne Lenker' }], total: 13 });

    const page = await ndListAlbumsByTagForServer('srv-b', 'recordlabel', 'tag-1', 0, 200, 'name', 'ASC', 'lib-b');

    expect(page.total).toBe(13);
    expect(page.albums[0]).toEqual(expect.objectContaining({ id: 'album-1', serverId: 'b.example' }));
    expect(loginMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith('nd_list_albums_by_tag', expect.objectContaining({
      tagName: 'recordlabel',
      tagId: 'tag-1',
      start: 0,
      end: 200,
      libraryId: 'lib-b',
    }));
  });

  it('reports a null total when the server omits the count header', async () => {
    invokeMock.mockResolvedValueOnce({ items: [], total: null });

    const page = await ndListAlbumsByTagForServer('srv-a', 'recordlabel', 'tag-1', 0, 200);

    expect(page).toEqual({ albums: [], total: null });
  });
});
