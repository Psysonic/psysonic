import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';

const loadLocalNewReleases = vi.fn();
const getAlbumList = vi.fn();
const deriveLibraryBrowseScope = vi.fn();
vi.mock('@/lib/library/newReleasesLocal', () => ({ loadLocalNewReleases: (...a: unknown[]) => loadLocalNewReleases(...a) }));
vi.mock('@/lib/api/subsonicLibrary', () => ({ getAlbumList: (...a: unknown[]) => getAlbumList(...a) }));
vi.mock('@/lib/library/libraryBrowseScope', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/library/libraryBrowseScope')>()),
  deriveLibraryBrowseScope: (...a: unknown[]) => deriveLibraryBrowseScope(...a),
}));

import { albumsAddedSince, loadNewestAlbums } from './newAlbumsSince';

const album = (id: string, artist: string, name: string, created?: string) =>
  ({ id, artist, name, created }) as SubsonicAlbum;

describe('albumsAddedSince', () => {
  const list = [
    album('1', 'tester', 'Beta', '2026-11-04T10:00:00Z'),
    album('2', 'Alice', 'Zeta', '2026-11-05T10:00:00Z'),
    album('3', 'Bob', 'Old', '2026-10-01T10:00:00Z'),
    album('4', 'Alice', 'Alpha', '2026-11-03T00:00:00Z'),
    album('5', 'Bob', 'No date'),
  ];
  const since = Date.parse('2026-11-03T00:00:00Z');

  it('keeps albums on or after the start, sorted by artist then title', () => {
    expect(albumsAddedSince(list, since).map(a => a.id)).toEqual(['4', '2', '1']);
  });

  it('keeps everything for a non-positive start', () => {
    expect(albumsAddedSince(list, 0)).toHaveLength(5);
  });

  it('does not reorder the input', () => {
    albumsAddedSince(list, since);
    expect(list.map(a => a.id)).toEqual(['1', '2', '3', '4', '5']);
  });
});

describe('loadNewestAlbums', () => {
  beforeEach(() => {
    loadLocalNewReleases.mockReset();
    getAlbumList.mockReset();
    deriveLibraryBrowseScope.mockReset();
    deriveLibraryBrowseScope.mockReturnValue({ anchorServerId: 'srv', pairs: [{ serverId: 'srv', libraryId: null }] });
  });

  it('reads the New Releases feed from the index, page by page, without asking the server', async () => {
    loadLocalNewReleases
      .mockResolvedValueOnce({ albums: [album('a', 'tester', 'A')], hasMore: true, genreCounts: [] })
      .mockResolvedValueOnce({ albums: [album('b', 'tester', 'B')], hasMore: false, genreCounts: [] });
    const result = await loadNewestAlbums();
    expect(result.map(a => a.id)).toEqual(['a', 'b']);
    expect(loadLocalNewReleases).toHaveBeenCalledTimes(2);
    expect(loadLocalNewReleases.mock.calls[1][3]).toBe(100);
    expect(getAlbumList).not.toHaveBeenCalled();
  });

  it('stops at 500 albums', async () => {
    loadLocalNewReleases.mockResolvedValue({ albums: [album('x', 'tester', 'X')], hasMore: true, genreCounts: [] });
    await loadNewestAlbums();
    expect(loadLocalNewReleases).toHaveBeenCalledTimes(5);
  });

  it('falls back to the server list while the index is still empty', async () => {
    loadLocalNewReleases.mockResolvedValue({ albums: [], hasMore: false, genreCounts: [] });
    getAlbumList.mockResolvedValue([album('n', 'tester', 'N')]);
    expect((await loadNewestAlbums()).map(a => a.id)).toEqual(['n']);
    expect(getAlbumList).toHaveBeenCalledWith('newest', 500);
  });

  it('falls back to the server list when there is no browse scope', async () => {
    deriveLibraryBrowseScope.mockReturnValue({ anchorServerId: null, pairs: [] });
    getAlbumList.mockResolvedValue([]);
    await loadNewestAlbums();
    expect(loadLocalNewReleases).not.toHaveBeenCalled();
    expect(getAlbumList).toHaveBeenCalledTimes(1);
  });
});
