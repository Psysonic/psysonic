import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';
import type { AlbumYearDisplay } from '@/features/album/store/albumYearDisplayStore';

type DatedAlbum = Pick<
  SubsonicAlbum,
  'year' | 'originalYear' | 'releaseYear' | 'originalReleaseDate' | 'releaseDate'
>;

function positive(year: number | undefined | null): number | undefined {
  return typeof year === 'number' && Number.isFinite(year) && year > 0 ? year : undefined;
}

/**
 * Original release year: the local index's resolved value, then the server's
 * OpenSubsonic date. `year` is only the last resort — which of the two years it
 * holds depends on how the files were tagged.
 */
export function albumOriginalYear(album: DatedAlbum): number | undefined {
  return positive(album.originalYear)
    ?? positive(album.originalReleaseDate?.year)
    ?? positive(album.year);
}

/** This edition's release year, by the same order. */
export function albumReleaseYear(album: DatedAlbum): number | undefined {
  return positive(album.releaseYear)
    ?? positive(album.releaseDate?.year)
    ?? positive(album.year);
}

/** The year text for an album, or `null` when the album carries no year at all. */
export function formatAlbumYear(album: DatedAlbum, display: AlbumYearDisplay): string | null {
  const original = albumOriginalYear(album);
  const release = albumReleaseYear(album);
  if (display === 'release') return release != null ? String(release) : null;
  if (display === 'both' && original != null && release != null && original !== release) {
    return `${original} · ${release}`;
  }
  return original != null ? String(original) : null;
}
