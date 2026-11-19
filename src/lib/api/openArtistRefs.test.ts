import { describe, expect, it } from 'vitest';
import {
  coerceOpenArtistRefs,
  displayArtistRefs,
  firstArtistName,
  splitDisplayArtistName,
  structuredArtistNames,
} from '@/lib/api/openArtistRefs';

describe('coerceOpenArtistRefs', () => {
  it('returns an empty array for nullish input', () => {
    expect(coerceOpenArtistRefs(undefined)).toEqual([]);
    expect(coerceOpenArtistRefs(null)).toEqual([]);
  });

  it('passes through arrays', () => {
    const refs = [{ id: 'a1', name: 'One' }, { id: 'a2', name: 'Two' }];
    expect(coerceOpenArtistRefs(refs)).toBe(refs);
  });

  it('wraps a single ref object from Subsonic JSON', () => {
    const ref = { id: 'a1', name: 'Solo' };
    expect(coerceOpenArtistRefs(ref)).toEqual([ref]);
  });

  it('trims server whitespace from structured artist names and ids', () => {
    expect(coerceOpenArtistRefs([
      { id: ' lead ', name: 'Saltatio Mortis ' },
      { id: ' guest ', name: ' Blind Guardian' },
    ])).toEqual([
      { id: 'lead', name: 'Saltatio Mortis' },
      { id: 'guest', name: 'Blind Guardian' },
    ]);
  });
});

describe('splitDisplayArtistName', () => {
  it('splits on every separator the server uses, case-insensitively', () => {
    expect(splitDisplayArtistName('Alice feat. Bob')).toEqual(['Alice', 'Bob']);
    expect(splitDisplayArtistName('Alice FEAT. Bob')).toEqual(['Alice', 'Bob']);
    expect(splitDisplayArtistName('Alice feat Bob')).toEqual(['Alice', 'Bob']);
    expect(splitDisplayArtistName('Alice ft. Bob')).toEqual(['Alice', 'Bob']);
    expect(splitDisplayArtistName('Alice ft Bob')).toEqual(['Alice', 'Bob']);
    expect(splitDisplayArtistName('Alice / Bob')).toEqual(['Alice', 'Bob']);
    expect(splitDisplayArtistName('Alice; Bob')).toEqual(['Alice', 'Bob']);
  });

  it('splits on the joiner Navidrome inserts between only-plural artists', () => {
    // When a track has only plural ARTISTS tags (no singular ARTIST), Navidrome
    // builds the display name with its default Scanner.ArtistJoiner — " • ".
    expect(splitDisplayArtistName('Alice • Bob')).toEqual(['Alice', 'Bob']);
    expect(splitDisplayArtistName('Alice • Bob • Carol')).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('splits a credit with several guests', () => {
    expect(splitDisplayArtistName('Alice feat. Bob / Carol')).toEqual(['Alice', 'Bob', 'Carol']);
  });

  // Both of these are explicit in the server's tagging spec — relaxing either rule
  // would break real artist names.
  it('keeps a slash without surrounding spaces intact', () => {
    expect(splitDisplayArtistName('AC/DC')).toEqual(['AC/DC']);
  });

  it('does not treat a comma as a separator', () => {
    expect(splitDisplayArtistName('Daniel Hope, Konzerthaus Kammerorchester Berlin'))
      .toEqual(['Daniel Hope, Konzerthaus Kammerorchester Berlin']);
  });

  it('does not split a name that merely contains a separator word', () => {
    expect(splitDisplayArtistName('Fatboy Slim')).toEqual(['Fatboy Slim']);
    expect(splitDisplayArtistName('Left of Center')).toEqual(['Left of Center']);
  });

  it('returns nothing for empty input', () => {
    expect(splitDisplayArtistName(undefined)).toEqual([]);
    expect(splitDisplayArtistName('   ')).toEqual([]);
  });
});

describe('displayArtistRefs', () => {
  it('keeps the id on the primary artist only', () => {
    expect(displayArtistRefs('Alice feat. Bob', 'ar-alice')).toEqual([
      { id: 'ar-alice', name: 'Alice' },
      { name: 'Bob' },
    ]);
  });

  it('returns one ref with the id when there is nothing to split', () => {
    expect(displayArtistRefs('Alice', 'ar-alice')).toEqual([{ id: 'ar-alice', name: 'Alice' }]);
  });

  it('omits the id when the server gave none', () => {
    expect(displayArtistRefs('Alice feat. Bob')).toEqual([{ name: 'Alice' }, { name: 'Bob' }]);
  });
});

describe('structuredArtistNames', () => {
  it('returns trimmed names in order from structured refs', () => {
    expect(structuredArtistNames([
      { id: 'a1', name: ' Alice ' },
      { id: 'a2', name: 'Bob ' },
    ])).toEqual(['Alice', 'Bob']);
  });

  it('wraps a single ref object and drops empty trailing names', () => {
    expect(structuredArtistNames({ id: 'a1', name: 'Solo' })).toEqual(['Solo']);
    expect(structuredArtistNames([{ name: 'Alice' }, { id: 'a2', name: '  ' }, { name: 'Bob' }]))
      .toEqual(['Alice', 'Bob']);
  });

  it('returns undefined when absent or when slot 0 has no name', () => {
    expect(structuredArtistNames(undefined)).toBeUndefined();
    expect(structuredArtistNames(null)).toBeUndefined();
    expect(structuredArtistNames([])).toBeUndefined();
    expect(structuredArtistNames([{ id: 'a1' }, { id: 'a2', name: 'Bob' }])).toBeUndefined();
    expect(structuredArtistNames([{ id: 'a1', name: '   ' }, { id: 'a2', name: 'Bob' }])).toBeUndefined();
  });
});

describe('firstArtistName', () => {
  it('prefers slot 0 of structured refs even when the display string uses commas or ampersands', () => {
    expect(firstArtistName('Alice, Bob & Carol', [
      { id: 'a1', name: 'Alice' },
      { id: 'a2', name: 'Bob' },
    ])).toBe('Alice');
    expect(firstArtistName('Alice & Bob', { id: 'a1', name: 'Alice' })).toBe('Alice');
  });

  it('prefers slot 0 of string[] and trims whitespace', () => {
    expect(firstArtistName('Alice, Bob', [' Alice ', 'Bob'])).toBe('Alice');
  });

  it('falls back to splitting the display string without promoting a guest when slot 0 has no name', () => {
    expect(firstArtistName('Alice feat. Bob', [{ id: 'a1' }, { id: 'a2', name: 'Bob' }])).toBe('Alice');
    expect(firstArtistName('Alice feat. Bob', ['   ', 'Bob'])).toBe('Alice');
  });

  it('splits joined display strings when structured artists are absent', () => {
    expect(firstArtistName('Alice feat. Bob')).toBe('Alice');
    expect(firstArtistName('Alice ft Bob / Carol')).toBe('Alice');
    expect(firstArtistName('Alice; Bob')).toBe('Alice');
    expect(firstArtistName('Alice • Bob')).toBe('Alice');
  });

  it('keeps unsplittable names intact and handles blank strings', () => {
    expect(firstArtistName('AC/DC')).toBe('AC/DC');
    expect(firstArtistName('Daniel Hope, Konzerthaus Kammerorchester Berlin'))
      .toBe('Daniel Hope, Konzerthaus Kammerorchester Berlin');
    expect(firstArtistName('  Solo Artist  ')).toBe('Solo Artist');
    expect(firstArtistName('   ')).toBe('');
  });
});
