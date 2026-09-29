import { beforeEach, describe, expect, it, vi } from 'vitest';
import { albumsMatchingLabel, fetchLabelAlbumPage, fetchLabelAlbumTotal } from './labelAlbumBrowse';

vi.mock('@/lib/api/library', () => ({
  libraryListAlbumsByLabel: vi.fn(),
}));

vi.mock('@/lib/api/subsonicSearch', () => ({
  search: vi.fn(),
}));

vi.mock('@/lib/api/subsonicClient', () => ({
  libraryScopeForServer: vi.fn(() => 'lib-a'),
  libraryScopePairsForServer: vi.fn(() => [{ serverId: 'srv-1', libraryId: 'lib-a' }]),
}));

vi.mock('./libraryReady', () => ({
  readyLibraryServerKeys: vi.fn(),
}));

import { libraryListAlbumsByLabel } from '@/lib/api/library';
import { search } from '@/lib/api/subsonicSearch';
import { readyLibraryServerKeys } from './libraryReady';

const localAlbum = {
  serverId: 'srv-1',
  id: 'al-1',
  name: 'Album',
  artist: 'Artist',
  artistId: 'ar-1',
  songCount: 8,
  durationSec: 100,
  syncedAt: 0,
  rawJson: {},
};

const multiServerScope = {
  anchorServerId: 'srv-1',
  serverIds: ['srv-1', 'srv-2'],
  pairs: [
    { serverId: 'srv-1', libraryId: null },
    { serverId: 'srv-2', libraryId: 'lib-9' },
  ],
  fingerprint: 'scope',
  multiServer: true,
};

describe('labelAlbumBrowse', () => {
  beforeEach(() => {
    vi.mocked(readyLibraryServerKeys).mockReset();
    vi.mocked(libraryListAlbumsByLabel).mockReset();
    vi.mocked(search).mockReset();
  });

  it('pages albums from the local label index when it is ready', async () => {
    vi.mocked(readyLibraryServerKeys).mockResolvedValue(['srv-1']);
    vi.mocked(libraryListAlbumsByLabel).mockResolvedValue({ source: 'local', hasMore: true, albums: [localAlbum] });

    const page = await fetchLabelAlbumPage('srv-1', 'Warp', true, 200, 200, 'alphabeticalByName');

    expect(libraryListAlbumsByLabel).toHaveBeenCalledWith(expect.objectContaining({
      serverId: 'srv-1',
      label: 'Warp',
      libraryScope: 'lib-a',
      libraryScopes: [{ serverId: 'srv-1', libraryId: 'lib-a' }],
      offset: 200,
      limit: 200,
    }));
    expect(search).not.toHaveBeenCalled();
    expect(page.albums).toHaveLength(1);
    expect(page.hasMore).toBe(true);
  });

  it('sends every server and library of a multi-server scope', async () => {
    vi.mocked(readyLibraryServerKeys).mockResolvedValue(['srv-1', 'srv-2']);
    vi.mocked(libraryListAlbumsByLabel).mockResolvedValue({ source: 'local', hasMore: false, albums: [] });

    await fetchLabelAlbumPage('srv-1', 'Warp', true, 0, 60, 'alphabeticalByName', multiServerScope);

    expect(readyLibraryServerKeys).toHaveBeenCalledWith(['srv-1', 'srv-2']);
    expect(libraryListAlbumsByLabel).toHaveBeenCalledWith(expect.objectContaining({
      libraryScope: undefined,
      libraryScopes: multiServerScope.pairs,
    }));
  });

  it('falls back to one search page while the index is not ready', async () => {
    vi.mocked(readyLibraryServerKeys).mockResolvedValue(null);
    vi.mocked(search).mockResolvedValue({
      artists: [],
      songs: [],
      albums: [
        { id: 'a', name: 'On Warp', artist: 'X', artistId: 'x', songCount: 1, duration: 1, recordLabel: 'Warp' },
        { id: 'b', name: 'Warped', artist: 'Y', artistId: 'y', songCount: 1, duration: 1, recordLabel: 'Other' },
      ],
    });

    const first = await fetchLabelAlbumPage('srv-1', 'Warp', true, 0, 60, 'alphabeticalByName');
    expect(libraryListAlbumsByLabel).not.toHaveBeenCalled();
    expect(first.albums.map(a => a.id)).toEqual(['a']);
    expect(first.hasMore).toBe(false);

    const second = await fetchLabelAlbumPage('srv-1', 'Warp', true, 60, 60, 'alphabeticalByName');
    expect(second).toEqual({ albums: [], hasMore: false });
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('reads the album total from the index, and none before it is ready', async () => {
    vi.mocked(readyLibraryServerKeys).mockResolvedValueOnce(['srv-1']);
    vi.mocked(libraryListAlbumsByLabel).mockResolvedValue({ source: 'local', hasMore: false, albums: [], total: 42 });
    await expect(fetchLabelAlbumTotal('srv-1', 'Warp', true, 'alphabeticalByName')).resolves.toBe(42);
    expect(libraryListAlbumsByLabel).toHaveBeenCalledWith(expect.objectContaining({ countOnly: true, includeTotal: true }));

    vi.mocked(readyLibraryServerKeys).mockResolvedValueOnce(null);
    await expect(fetchLabelAlbumTotal('srv-1', 'Warp', true, 'alphabeticalByName')).resolves.toBeNull();
  });
});

describe('albumsMatchingLabel', () => {
  it('keeps exact label matches, else every hit', () => {
    const albums = [
      { id: 'a', name: 'A', artist: '', artistId: '', songCount: 0, duration: 0, recordLabel: 'warp ' },
      { id: 'b', name: 'B', artist: '', artistId: '', songCount: 0, duration: 0 },
    ];
    expect(albumsMatchingLabel(albums, 'Warp').map(a => a.id)).toEqual(['a']);
    expect(albumsMatchingLabel(albums, 'Bleep').map(a => a.id)).toEqual(['a', 'b']);
  });
});
