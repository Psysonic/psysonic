import { TRACK_TITLE_COL, type ColDef } from '@/lib/hooks/useTracklistColumns';

/**
 * Columns of the paged song lists (Tracks page, search results, advanced
 * search, mood detail). They load page by page, so a header click could only
 * sort the rows loaded so far: these headers do not sort.
 */
export const SONG_LIST_COLUMNS: readonly ColDef[] = [
  { key: 'actions',  i18nKey: null, nameKey: 'albumDetail.trackActions', minWidth: 64, defaultWidth: 72,  required: true, align: 'center' },
  { key: 'title',    i18nKey: 'trackTitle',    ...TRACK_TITLE_COL, required: true },
  { key: 'artist',   i18nKey: 'trackArtist',   minWidth: 80, defaultWidth: 200, required: false },
  { key: 'album',    i18nKey: 'trackAlbum',    minWidth: 80, defaultWidth: 200, required: false },
  { key: 'genre',    i18nKey: 'trackGenre',    minWidth: 70, defaultWidth: 120, required: false },
  // Only shown where the page asks for it (advanced search with a BPM filter).
  { key: 'bpm',      i18nKey: 'trackBpm',      minWidth: 44, defaultWidth: 60,  required: false },
  { key: 'duration', i18nKey: 'trackDuration', minWidth: 56, defaultWidth: 72,  required: false },
];

export const SONG_LIST_STORAGE_KEY = 'psysonic_song_list_columns';
