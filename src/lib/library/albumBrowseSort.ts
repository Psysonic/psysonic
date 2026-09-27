import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';
import type { LibrarySortClause } from '@/lib/api/library';

export type AlbumBrowseSort =
  | 'alphabeticalByName'
  | 'alphabeticalByArtist'
  | 'byArtistThenYear'
  | 'byYear';

export function albumSortClauses(sort: AlbumBrowseSort): LibrarySortClause[] {
  // Always append secondary keys so albums sharing the primary key keep a stable
  // order (mirrors `sortSubsonicAlbums`).
  if (sort === 'byArtistThenYear') {
    // Artist, then chronological (oldest first), then title as a same-year tiebreak.
    return [
      { field: 'artist', dir: 'asc' },
      { field: 'year', dir: 'asc' },
      { field: 'name', dir: 'asc' },
    ];
  }
  if (sort === 'byYear') {
    // Chronological (oldest first); artist then title keep same-year albums grouped.
    return [
      { field: 'year', dir: 'asc' },
      { field: 'artist', dir: 'asc' },
      { field: 'name', dir: 'asc' },
    ];
  }
  if (sort === 'alphabeticalByArtist') {
    return [
      { field: 'artist', dir: 'asc' },
      { field: 'name', dir: 'asc' },
    ];
  }
  return [
    { field: 'name', dir: 'asc' },
    { field: 'artist', dir: 'asc' },
  ];
}

/**
 * Subsonic `getAlbumList` type to fetch with for a browse sort (server fallback
 * path only — the local index handles sorting itself). `byArtistThenYear` has
 * no server equivalent, so fetch by artist and let `sortSubsonicAlbums` apply
 * the per-page year ordering on top. `byYear` needs a year range; see
 * `albumListFetchParams`.
 */
export function albumListFetchType(
  sort: AlbumBrowseSort,
): 'alphabeticalByName' | 'alphabeticalByArtist' | 'byYear' {
  if (sort === 'byYear') return 'byYear';
  return sort === 'alphabeticalByName' ? 'alphabeticalByName' : 'alphabeticalByArtist';
}

/**
 * Extra `getAlbumList` params for an unfiltered browse sort. The Subsonic
 * `byYear` list requires `fromYear`/`toYear`, so span every plausible year
 * (0 keeps albums without a year tag in the list).
 */
export function albumListFetchParams(sort: AlbumBrowseSort): Record<string, number> {
  return sort === 'byYear' ? { fromYear: 0, toYear: 9999 } : {};
}

export function sortSubsonicAlbums(albums: SubsonicAlbum[], sort: AlbumBrowseSort): SubsonicAlbum[] {
  const out = [...albums];
  out.sort((a, b) => {
    if (sort === 'byYear') {
      return (
        (a.year ?? 0) - (b.year ?? 0) ||
        a.artist.localeCompare(b.artist) ||
        a.name.localeCompare(b.name)
      );
    }
    if (sort === 'byArtistThenYear') {
      return (
        a.artist.localeCompare(b.artist) ||
        (a.year ?? 0) - (b.year ?? 0) ||
        a.name.localeCompare(b.name)
      );
    }
    return sort === 'alphabeticalByArtist'
      ? a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name)
      : a.name.localeCompare(b.name) || a.artist.localeCompare(b.artist);
  });
  return out;
}
