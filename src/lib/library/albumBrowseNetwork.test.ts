import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';
import type { AlbumBrowseQuery } from './albumBrowseTypes';

const getAlbumListMock = vi.fn();

vi.mock('@/lib/api/subsonicLibrary', () => ({
  getAlbumList: (...args: unknown[]) => getAlbumListMock(...args),
  getAlbumListForServer: (_serverId: string, ...args: unknown[]) => getAlbumListMock(...args),
}));
vi.mock('@/lib/api/subsonicGenres', () => ({
  getAlbumsByGenre: vi.fn(),
  getAlbumsByGenreForServer: vi.fn(),
}));

import { fetchAlbumBrowseNetwork } from './albumBrowseNetwork';

const album = (id: string, year: number): SubsonicAlbum =>
  ({ id, name: id, artist: 'Artist', year }) as SubsonicAlbum;

const query = (overrides: Partial<AlbumBrowseQuery>): AlbumBrowseQuery => ({
  sort: 'byYearDesc',
  genres: [],
  losslessOnly: false,
  starredOnly: false,
  compFilter: 'all',
  ...overrides,
});

/** Serves `byYear` pages the way Subsonic does: a reversed range lists newest first. */
function serveByYear(albums: SubsonicAlbum[]) {
  getAlbumListMock.mockImplementation(
    async (_type: string, size: number, offset: number, extra: { fromYear: number; toYear: number }) => {
      const lo = Math.min(extra.fromYear, extra.toYear);
      const hi = Math.max(extra.fromYear, extra.toYear);
      const inRange = albums
        .filter(a => (a.year ?? 0) >= lo && (a.year ?? 0) <= hi)
        .sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
      if (extra.fromYear > extra.toYear) inRange.reverse();
      return inRange.slice(offset, offset + size);
    },
  );
}

describe('fetchAlbumBrowseNetwork year sorts', () => {
  beforeEach(() => {
    getAlbumListMock.mockReset();
  });

  it('keeps newest first across pages when a year filter is set', async () => {
    serveByYear([album('a', 1990), album('b', 1995), album('c', 2000), album('d', 2005)]);
    const q = query({ year: { from: 1990, to: 2005 } });

    const first = await fetchAlbumBrowseNetwork(q, 0, 2, 'srv');
    const second = await fetchAlbumBrowseNetwork(q, 2, 2, 'srv');

    expect([...first.albums, ...second.albums].map(a => a.year)).toEqual([2005, 2000, 1995, 1990]);
    expect(getAlbumListMock).toHaveBeenCalledWith('byYear', 2, 0, { fromYear: 2005, toYear: 1990 });
  });

  it('keeps oldest first across pages when a year filter is set', async () => {
    serveByYear([album('a', 1990), album('b', 1995), album('c', 2000), album('d', 2005)]);
    const q = query({ sort: 'byYear', year: { from: 1990, to: 2005 } });

    const first = await fetchAlbumBrowseNetwork(q, 0, 2, 'srv');
    const second = await fetchAlbumBrowseNetwork(q, 2, 2, 'srv');

    expect([...first.albums, ...second.albums].map(a => a.year)).toEqual([1990, 1995, 2000, 2005]);
  });

  it('keeps the plain year-filter range for a non-year sort', async () => {
    serveByYear([]);
    await fetchAlbumBrowseNetwork(
      query({ sort: 'alphabeticalByName', year: { from: 2000 } }),
      0,
      2,
      'srv',
    );

    expect(getAlbumListMock).toHaveBeenCalledWith('byYear', 2, 0, { fromYear: 2000 });
  });

  it('pages the unfiltered newest-first list across every year', async () => {
    serveByYear([album('a', 1990), album('b', 2005), album('c', 2000)]);
    const q = query({});

    const first = await fetchAlbumBrowseNetwork(q, 0, 2, 'srv');
    const second = await fetchAlbumBrowseNetwork(q, 2, 2, 'srv');

    expect([...first.albums, ...second.albums].map(a => a.year)).toEqual([2005, 2000, 1990]);
    expect(first.hasMore).toBe(true);
    expect(second.hasMore).toBe(false);
  });
});
