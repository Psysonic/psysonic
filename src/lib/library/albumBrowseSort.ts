import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';
import type { LibrarySortClause } from '@/lib/api/library';
import type { AlbumYearBounds } from './albumYearFilter';

export type AlbumBrowseSort =
  | 'alphabeticalByName'
  | 'alphabeticalByArtist'
  | 'byArtistThenYear'
  | 'byYear'
  | 'byYearDesc';

/**
 * Next sort when the Year control is pressed: newest first on the first press,
 * then flip between newest and oldest first on each press after that.
 */
export function nextYearSort(current: AlbumBrowseSort): AlbumBrowseSort {
  return current === 'byYearDesc' ? 'byYear' : 'byYearDesc';
}

export function isYearSort(sort: AlbumBrowseSort): boolean {
  return sort === 'byYear' || sort === 'byYearDesc';
}

/**
 * The single Year entry of a sort dropdown. While a year sort is active it
 * carries that sort, so picking it again flips the direction (see `pickedSort`);
 * otherwise it offers newest first.
 */
export function yearSortOption(
  current: AlbumBrowseSort,
  label: string,
): { value: AlbumBrowseSort; label: string } {
  const value = isYearSort(current) ? current : 'byYearDesc';
  return { value, label: `${label} ${value === 'byYearDesc' ? '↓' : '↑'}` };
}

/** Sort to apply when `picked` is chosen from a dropdown while `current` is active. */
export function pickedSort(current: AlbumBrowseSort, picked: AlbumBrowseSort): AlbumBrowseSort {
  return isYearSort(picked) && isYearSort(current) ? nextYearSort(current) : picked;
}

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
  if (isYearSort(sort)) {
    // Chronological (oldest first, or newest first for `byYearDesc`); artist then
    // title keep same-year albums grouped.
    return [
      { field: 'year', dir: sort === 'byYearDesc' ? 'desc' : 'asc' },
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
  if (isYearSort(sort)) return 'byYear';
  return sort === 'alphabeticalByName' ? 'alphabeticalByName' : 'alphabeticalByArtist';
}

/**
 * Extra `getAlbumList` params for a browse sort, narrowed by the year filter
 * when one is set. The Subsonic `byYear` list requires `fromYear`/`toYear`, so
 * an open bound spans every plausible year (0 keeps albums without a year tag
 * in the list). The server lists newest first when `fromYear` is greater than
 * `toYear`, so the range follows the sort direction: re-sorting each page in
 * `sortSubsonicAlbums` cannot fix the year order across pages.
 */
export function albumListFetchParams(
  sort: AlbumBrowseSort,
  year?: AlbumYearBounds,
): Record<string, number> {
  if (!isYearSort(sort)) return {};
  const from = year?.from ?? 0;
  const to = year?.to ?? 9999;
  const oldest = Math.min(from, to);
  const newest = Math.max(from, to);
  return sort === 'byYearDesc'
    ? { fromYear: newest, toYear: oldest }
    : { fromYear: oldest, toYear: newest };
}

export function sortSubsonicAlbums(albums: SubsonicAlbum[], sort: AlbumBrowseSort): SubsonicAlbum[] {
  const out = [...albums];
  out.sort((a, b) => {
    if (isYearSort(sort)) {
      // The server already returns pages in year order (see `albumListFetchParams`);
      // artist and title only tie-break within this page, not across a year
      // that spans a page boundary.
      const byYear = (a.year ?? 0) - (b.year ?? 0);
      return (
        (sort === 'byYearDesc' ? -byYear : byYear) ||
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
