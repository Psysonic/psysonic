import { TRACK_TITLE_COL, type ColDef } from '@/lib/hooks/useTracklistColumns';

/**
 * Columns of the random mix tables. The genre-mix table shows the same columns
 * without `genre` (every row there has the picked genres), so both tables share
 * one set of widths, order and visibility.
 */
export const RANDOM_MIX_COLUMNS: readonly ColDef[] = [
  { key: 'num',      i18nKey: null,            minWidth: 50, defaultWidth: 60,  required: true, align: 'end' },
  { key: 'title',    i18nKey: 'trackTitle',    ...TRACK_TITLE_COL, required: true },
  { key: 'artist',   i18nKey: 'trackArtist',   minWidth: 80, defaultWidth: 180, required: false },
  { key: 'album',    i18nKey: 'trackAlbum',    minWidth: 80, defaultWidth: 180, required: false },
  { key: 'genre',    i18nKey: 'trackGenre',    minWidth: 80, defaultWidth: 140, required: false },
  { key: 'favorite', i18nKey: 'trackFavorite', minWidth: 50, defaultWidth: 70,  required: false, align: 'center' },
  { key: 'duration', i18nKey: 'trackDuration', minWidth: 60, defaultWidth: 72,  required: false },
];

export const RANDOM_MIX_STORAGE_KEY = 'psysonic_random_mix_columns';
