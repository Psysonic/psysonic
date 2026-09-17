import { describe, expect, it } from 'vitest';
import { genresLabel, moodsLabel } from './playlistDetailHelpers';
import { COLUMNS } from '@/features/album/utils/albumTrackListHelpers';
import { ARTIST_ALL_TRACKS_COLUMNS } from '@/features/artist/utils/artistAllTracksColumns';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';

function song(extra: Partial<SubsonicSong>): SubsonicSong {
  return {
    id: 't1',
    title: 'Track',
    artist: 'Artist',
    album: 'Album',
    albumId: 'a1',
    duration: 100,
    ...extra,
  } as SubsonicSong;
}

describe('genresLabel', () => {
  /**
   * The point of the second column: `genre` holds one name where the file is
   * tagged with several, and the full set lives in OpenSubsonic's `genres`.
   */
  it('lists every genre the server reports', () => {
    expect(genresLabel(song({
      genre: 'First',
      genres: [{ name: 'First' }, { name: 'Second' }, { name: 'Third' }],
    }))).toBe('First · Second · Third');
  });

  it('falls back to splitting the legacy single field', () => {
    expect(genresLabel(song({ genre: 'First; Second' }))).toBe('First · Second');
  });

  it('is empty when the track carries no genre at all', () => {
    expect(genresLabel(song({}))).toBe('');
  });
});

describe('moodsLabel', () => {
  /**
   * Measured against a Navidrome library: mood tags arrive as plain strings,
   * unlike `genres`, which arrives as `{ name }` objects.
   */
  it('lists the mood tags the file carries', () => {
    expect(moodsLabel(song({ moods: ['Love', 'Emotional', 'Romantic'] })))
      .toBe('Love · Emotional · Romantic');
  });

  it('drops blanks and case-insensitive repeats', () => {
    expect(moodsLabel(song({ moods: ['Dark', ' ', 'dark', 'Sport'] }))).toBe('Dark · Sport');
  });

  it('is empty for an untagged track', () => {
    expect(moodsLabel(song({}))).toBe('');
  });
});

describe('the genres column', () => {
  // Asked for as an extra column rather than a replacement, so the narrow
  // single-genre column stays available — hence off until someone picks it.
  it('is offered off by default in both column sets', () => {
    for (const columns of [COLUMNS, ARTIST_ALL_TRACKS_COLUMNS]) {
      const col = columns.find(c => c.key === 'genres');
      expect(col).toBeDefined();
      expect(col?.defaultHidden).toBe(true);
      expect(columns.find(c => c.key === 'genre')).toBeDefined();
    }
  });

  // Most libraries have no mood tags at all, so an always-on column would be a
  // column of dashes for nearly everyone.
  it('offers the mood column off by default too', () => {
    for (const columns of [COLUMNS, ARTIST_ALL_TRACKS_COLUMNS]) {
      const col = columns.find(c => c.key === 'mood');
      expect(col).toBeDefined();
      expect(col?.defaultHidden).toBe(true);
    }
  });
});
