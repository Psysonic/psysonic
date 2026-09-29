import { describe, it, expect } from 'vitest';
import { deriveAlbumComment } from './albumComment';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';

function song(id: string, comment?: string): SubsonicSong {
  return {
    id,
    title: `Track ${id}`,
    artist: 'tester',
    album: 'Test Album',
    albumId: 'album-1',
    duration: 180,
    ...(comment === undefined ? {} : { comment }),
  };
}

describe('deriveAlbumComment', () => {
  it('returns the text when every track carries the same one', () => {
    // The common shape: 918 of 1,104 commented albums in the reference library.
    const songs = Array.from({ length: 9 }, (_, i) => song(String(i), 'Remaster 2024'));
    expect(deriveAlbumComment(songs)).toBe('Remaster 2024');
  });

  it('returns the text when only some tracks carry it', () => {
    // 55 albums look like this — typically a second disc left untagged. The
    // release still says one thing, so dropping it would lose real data.
    expect(deriveAlbumComment([
      song('1', 'Remaster 2024'),
      song('2'),
      song('3', 'Remaster 2024'),
    ])).toBe('Remaster 2024');
  });

  it('returns null when tracks disagree', () => {
    // 131 albums. Showing one of these would promote a single track's note
    // into a statement about the whole release.
    expect(deriveAlbumComment([
      song('1', 'Remaster 2024'),
      song('2', 'alternate take'),
    ])).toBeNull();
  });

  it('returns null when no track carries a comment', () => {
    expect(deriveAlbumComment([song('1'), song('2')])).toBeNull();
  });

  it('treats blank and whitespace-only comments as absent', () => {
    expect(deriveAlbumComment([song('1', ''), song('2', '   ')])).toBeNull();
    expect(deriveAlbumComment([song('1', '  '), song('2', 'Remaster 2024')]))
      .toBe('Remaster 2024');
  });

  it('ignores surrounding whitespace when comparing', () => {
    // Taggers pad differently across discs; that is not disagreement.
    expect(deriveAlbumComment([
      song('1', 'Remaster 2024'),
      song('2', '  Remaster 2024  '),
    ])).toBe('Remaster 2024');
  });

  it('returns null for an empty track list', () => {
    expect(deriveAlbumComment([])).toBeNull();
  });
});
