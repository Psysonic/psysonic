import { beforeEach, describe, expect, it, vi } from 'vitest';

const { albumList, folderList, playlist, auth, selection } = vi.hoisted(() => ({
  albumList: vi.fn(), folderList: vi.fn(), playlist: vi.fn(), selection: vi.fn(),
  auth: {
    servers: [{ id: 'owner', url: 'https://private.example' }],
    activeServerId: 'owner',
    libraryBrowseSelectionByServer: { owner: [] as string[] },
    musicLibrarySelectionByServer: { owner: [] as string[] },
    musicLibraryFilterByServer: { owner: 'audiobooks' },
    musicFoldersByServer: { owner: [{ id: 'music', name: 'Private music' }, { id: 'audiobooks', name: 'Private books' }] },
  },
}));

vi.mock('@/store/authStore', () => ({ useAuthStore: { getState: () => auth } }));
vi.mock('@/lib/api/subsonicClient', () => ({ librarySelectionForServer: selection }));
vi.mock('@/lib/api/subsonicPlaylists', () => ({ getPlaylistForServer: playlist }));
vi.mock('@/lib/api/subsonicLibrary', () => ({
  getAlbumListForServer: albumList,
  getMusicFoldersForServer: folderList,
}));

import { runPlaylistScopeDiagnostic } from './playlistScopeDiagnostic';

describe('playlist scope diagnostic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.libraryBrowseSelectionByServer.owner = [];
    auth.musicLibraryFilterByServer.owner = 'audiobooks';
    selection.mockReturnValue([]);
    playlist.mockResolvedValue({
      playlist: { songCount: 2, name: 'Private mix' },
      songs: [{ albumId: 'music-album' }, { albumId: 'music-album' }],
    });
    folderList.mockResolvedValue(auth.musicFoldersByServer.owner);
    albumList.mockImplementation(async (_server: string, _type: string, _size: number, _offset: number,
      _extra: object, _timeout: number, folderIds: string[]) => ({
      '': [{ id: 'music-album' }, { id: 'book-album' }],
      music: [{ id: 'music-album' }],
      audiobooks: [{ id: 'book-album' }],
    }[folderIds[0] ?? ''] ?? []));
  });

  it('finds the legacy-vs-sidebar mismatch without changing server or selection', async () => {
    const report = JSON.parse(await runPlaylistScopeDiagnostic('owner', 'playlist-private'));
    expect(report).toMatchObject({
      responseSongs: 2, sidebarSelectionCount: 0, historicalSource: 'legacy',
      historicalShown: { shown: 0, complete: true },
      sidebarShown: { shown: 2, complete: true },
      fullCatalog: { matchingSongs: 2 },
    });
    expect(report.folders.map((folder: { matchingSongs: number }) => folder.matchingSongs)).toEqual([2, 0]);
    expect(JSON.stringify(report)).not.toMatch(/playlist-private|music-album|book-album|Private|owner|audiobooks/);
    expect(auth.libraryBrowseSelectionByServer.owner).toEqual([]);
    expect(albumList).toHaveBeenCalledTimes(3);
    expect(albumList.mock.calls.every(call => call[0] === 'owner')).toBe(true);
  });

  it('tests selected music and reports a library-query failure without claiming zero matches', async () => {
    auth.libraryBrowseSelectionByServer.owner = ['music'];
    albumList.mockImplementation(async (_server: string, _type: string, _size: number, _offset: number,
      _extra: object, _timeout: number, folderIds: string[]) => {
      if (folderIds[0] === 'audiobooks') throw new Error('private server URL');
      return [{ id: 'music-album' }];
    });
    const report = JSON.parse(await runPlaylistScopeDiagnostic('owner', 'playlist-private'));
    expect(report.sidebarShown).toEqual({ shown: 2, complete: true });
    expect(report.historicalShown).toEqual({ shown: null, complete: false });
    expect(report.folders[1].error.errorType).toBe('Error');
    expect(JSON.stringify(report)).not.toContain('private server URL');
  });

  it('reports album-ID mismatch across the complete catalog separately from scope filtering', async () => {
    albumList.mockResolvedValue([{ id: 'unrelated-album' }]);
    const report = JSON.parse(await runPlaylistScopeDiagnostic('owner', 'playlist-private'));
    expect(report.responseSongs).toBe(2);
    expect(report.fullCatalog).toMatchObject({ albums: 1, complete: true, matchingSongs: 0 });
    expect(report.allLibrariesShown).toBe(2);
    expect(report.folders.every((folder: { matchingSongs: number }) => folder.matchingSongs === 0)).toBe(true);
  });

  it('models the original fail-open rule for a missing legacy folder', async () => {
    auth.musicLibraryFilterByServer.owner = 'removed-folder';
    const report = JSON.parse(await runPlaylistScopeDiagnostic('owner', 'playlist-private'));
    expect(report.historicalShown).toEqual({ shown: 2, complete: true });
    expect(report.folders.at(-1)).toMatchObject({
      historicalSelected: true, inSidebarCatalog: false, albums: 0,
    });
  });
});
