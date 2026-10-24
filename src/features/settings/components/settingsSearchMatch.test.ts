import { describe, expect, it } from 'vitest';
import {
  editDistance, exactTokenScore, normalizeSearchText, prepareText, queryTokens, tokenScore,
} from '@/features/settings/components/settingsSearchMatch';

describe('normalizeSearchText', () => {
  it('drops diacritics, markup and placeholders', () => {
    expect(normalizeSearchText('Lautstärke <strong>{{count}}</strong> Équalizer')).toBe('lautstarke equalizer');
  });
});

describe('queryTokens', () => {
  it('splits on spaces and punctuation', () => {
    expect(queryTokens('  Last.fm  hi-res ')).toEqual(['last', 'fm', 'hi', 'res']);
  });
});

describe('editDistance', () => {
  it('counts a swap of neighbours as one edit', () => {
    expect(editDistance('naivdrome', 'navidrome', 2)).toBe(1);
  });

  it('stops once the limit is exceeded', () => {
    expect(editDistance('volume', 'scrobble', 1)).toBe(2);
  });
});

describe('tokenScore', () => {
  const text = prepareText('Allow downloads of shared Navidrome links');

  it('ranks whole words above word starts and substrings', () => {
    const whole = tokenScore('downloads', text);
    const start = tokenScore('down', text);
    const inner = tokenScore('loads', text);
    expect(whole).toBe(1);
    expect(start).toBeLessThan(whole);
    expect(inner).toBeGreaterThan(0);
    expect(inner).toBeLessThan(start);
  });

  it('accepts typos', () => {
    expect(tokenScore('dowloads', text)).toBeGreaterThan(0);
    expect(tokenScore('navidorme', text)).toBeGreaterThan(0);
    expect(tokenScore('shraed', text)).toBeGreaterThan(0);
  });

  it('matches a plural query against the singular word', () => {
    expect(exactTokenScore('links', prepareText('Copy queue share link'))).toBeGreaterThan(0.8);
  });

  it('leaves typos to the caller', () => {
    expect(tokenScore('dowloads', text, false)).toBe(0);
  });

  it('rejects unrelated words and junk', () => {
    expect(tokenScore('equalizer', text)).toBe(0);
    expect(tokenScore('aaaaaaa', text)).toBe(0);
  });

  it('matches scripts without spaces by substring', () => {
    expect(tokenScore('共有', prepareText('Navidrome の共有リンク'))).toBeGreaterThan(0);
  });
});
