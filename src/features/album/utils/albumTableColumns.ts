import type { ColDef } from '@/lib/hooks/useTracklistColumns';

/**
 * Columns of the albums list view (All Albums, New Releases, Lossless). Labels
 * live in the `albums` namespace. The table scrolls sideways when the columns
 * are wider than the page, like every track table, instead of dropping columns
 * on narrow widths; unwanted columns are hidden from the header menu.
 */
export const ALBUM_TABLE_COLUMNS: readonly ColDef[] = [
  { key: 'cover',    i18nKey: 'albums.columnCover',    minWidth: 52,  defaultWidth: 60,  required: true, align: 'center' },
  { key: 'title',    i18nKey: 'albums.columnTitle',    minWidth: 160, defaultWidth: 320, required: true },
  { key: 'artist',   i18nKey: 'albums.columnArtist',   minWidth: 100, defaultWidth: 220, required: false },
  { key: 'songs',    i18nKey: 'albums.columnSongs',    minWidth: 56,  defaultWidth: 76,  required: false },
  { key: 'year',     i18nKey: 'albums.columnYear',     minWidth: 56,  defaultWidth: 76,  required: false },
  { key: 'duration', i18nKey: 'albums.columnDuration', minWidth: 64,  defaultWidth: 92,  required: false },
  { key: 'added',    i18nKey: 'albums.columnAdded',    minWidth: 90,  defaultWidth: 124, required: false },
];

export const ALBUM_TABLE_STORAGE_KEY = 'psysonic_album_table_columns';
