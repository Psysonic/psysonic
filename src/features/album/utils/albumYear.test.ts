import { describe, expect, it } from 'vitest';
import { albumOriginalYear, albumReleaseYear, formatAlbumYear } from './albumYear';

describe('album year display', () => {
  const reissue = { year: 2005, originalYear: 1971, releaseYear: 2005 };

  it('shows the original release by default and the edition on request', () => {
    expect(formatAlbumYear(reissue, 'original')).toBe('1971');
    expect(formatAlbumYear(reissue, 'release')).toBe('2005');
  });

  it('shows both years only when they differ', () => {
    expect(formatAlbumYear(reissue, 'both')).toBe('1971 · 2005');
    expect(formatAlbumYear({ year: 1996, originalYear: 1996, releaseYear: 1996 }, 'both')).toBe('1996');
  });

  it('reads the server dates when the index has not resolved the album', () => {
    const fromServer = {
      year: 2026,
      originalReleaseDate: { year: 1996 },
      releaseDate: { year: 2026 },
    };
    expect(albumOriginalYear(fromServer)).toBe(1996);
    expect(albumReleaseYear(fromServer)).toBe(2026);
  });

  it('falls back to year when nothing says which year it is', () => {
    expect(formatAlbumYear({ year: 1999 }, 'original')).toBe('1999');
    expect(formatAlbumYear({ year: 1999, releaseDate: {} }, 'release')).toBe('1999');
    expect(formatAlbumYear({ year: 1999 }, 'both')).toBe('1999');
  });

  it('uses the other known year when only one of the two is known', () => {
    const editionOnly = { releaseYear: 2005 };
    expect(formatAlbumYear(editionOnly, 'original')).toBe('2005');
    expect(formatAlbumYear(editionOnly, 'both')).toBe('2005');
    expect(formatAlbumYear(editionOnly, 'release')).toBe('2005');
    const originalOnly = { originalYear: 1971 };
    expect(formatAlbumYear(originalOnly, 'release')).toBe('1971');
    expect(formatAlbumYear(originalOnly, 'both')).toBe('1971');
    expect(formatAlbumYear({ releaseDate: { year: 2010 } }, 'original')).toBe('2010');
    expect(formatAlbumYear({ originalReleaseDate: { year: 1980 } }, 'release')).toBe('1980');
  });

  it('prefers year over the other kind of date', () => {
    expect(formatAlbumYear({ year: 1999, releaseYear: 2005 }, 'original')).toBe('1999');
    expect(formatAlbumYear({ year: 1999, originalYear: 1971 }, 'release')).toBe('1999');
  });

  it('ignores empty and zero years', () => {
    expect(formatAlbumYear({ year: 0 }, 'original')).toBeNull();
    expect(formatAlbumYear({ originalYear: 0, year: 1984 }, 'original')).toBe('1984');
    expect(formatAlbumYear({}, 'both')).toBeNull();
  });
});
