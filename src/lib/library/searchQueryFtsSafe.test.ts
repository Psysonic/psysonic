import { describe, expect, it } from 'vitest';
import { searchQueryIsFtsSafe, searchTokenIsFtsSafe, toFtsSafeSearchQuery } from './searchQueryFtsSafe';

describe('searchQueryIsFtsSafe', () => {
  it('rejects equals and wildcard-only junk queries', () => {
    expect(searchQueryIsFtsSafe('1=2')).toBe(false);
    expect(searchQueryIsFtsSafe('**')).toBe(false);
    expect(searchQueryIsFtsSafe('***')).toBe(false);
    expect(searchQueryIsFtsSafe('****')).toBe(false);
    expect(searchQueryIsFtsSafe('M=c')).toBe(false);
    expect(searchQueryIsFtsSafe('V()>P')).toBe(false);
  });

  it('accepts normal search terms and censorship stars in titles', () => {
    expect(searchQueryIsFtsSafe('metallica')).toBe(true);
    expect(searchQueryIsFtsSafe('love supreme')).toBe(true);
    expect(searchQueryIsFtsSafe('25')).toBe(true);
    expect(searchQueryIsFtsSafe('AC/DC')).toBe(true);
    expect(searchQueryIsFtsSafe('***Flawless')).toBe(true);
    expect(searchQueryIsFtsSafe('B********')).toBe(true);
    expect(searchQueryIsFtsSafe('F**k This Industry')).toBe(true);
  });

  it('rejects when any token is unsafe', () => {
    expect(searchQueryIsFtsSafe('dark side')).toBe(true);
    expect(searchQueryIsFtsSafe('dark = side')).toBe(false);
  });
});

describe('toFtsSafeSearchQuery', () => {
  it('turns punctuation-heavy titles into queries the guard accepts', () => {
    const cases: Array<[string, string]> = [
      ['Song (Part 2)', 'Song Part 2'],
      ['Title: The Subtitle', 'Title The Subtitle'],
      ['Rock & Roll', 'Rock Roll'],
      ['100% Pure Love', '100 Pure Love'],
      ['Hey ! Ho', 'Hey Ho'],
      ['AC/DC Song / Other', 'AC/DC Song Other'],
      ['Tears <3', 'Tears 3'],
    ];
    for (const [title, query] of cases) {
      expect(toFtsSafeSearchQuery(title)).toBe(query);
      expect(searchQueryIsFtsSafe(toFtsSafeSearchQuery(title))).toBe(true);
    }
  });

  it('leaves accents, apostrophes and censorship stars alone', () => {
    expect(toFtsSafeSearchQuery('Hjertet mitt blør')).toBe('Hjertet mitt blør');
    expect(toFtsSafeSearchQuery("Don't Stop Me Now")).toBe("Don't Stop Me Now");
    expect(toFtsSafeSearchQuery('F**k This Industry')).toBe('F**k This Industry');
  });

  it('returns an empty query when nothing searchable is left', () => {
    expect(toFtsSafeSearchQuery('!!! - ***')).toBe('');
    expect(toFtsSafeSearchQuery('1=2')).toBe('1 2');
  });
});

describe('searchTokenIsFtsSafe', () => {
  it('requires at least one letter or digit', () => {
    expect(searchTokenIsFtsSafe('***')).toBe(false);
    expect(searchTokenIsFtsSafe('!!!')).toBe(false);
  });
});
