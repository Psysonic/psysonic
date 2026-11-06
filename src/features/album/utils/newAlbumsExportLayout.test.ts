import { describe, expect, it } from 'vitest';
import { albumMetaLine, pageSizes, paginateEvenly, wrapText } from './newAlbumsExportLayout';

/** Monospace stand-in for canvas measureText: 10 px per character. */
const mono = (s: string) => Array.from(s).length * 10;

describe('paginateEvenly', () => {
  it('splits 31 albums into 16 + 15 and keeps every album once, in order', () => {
    const items = Array.from({ length: 31 }, (_, i) => i);
    const pages = paginateEvenly(items, 16);
    expect(pages.map(p => p.length)).toEqual([16, 15]);
    expect(pages.flat()).toEqual(items);
  });

  it('balances small overflows instead of leaving a near-empty page', () => {
    expect(pageSizes(17, 16)).toEqual([9, 8]);
    expect(pageSizes(33, 16)).toEqual([11, 11, 11]);
  });

  it('keeps one page up to the limit and returns nothing for no albums', () => {
    expect(pageSizes(1, 16)).toEqual([1]);
    expect(pageSizes(16, 16)).toEqual([16]);
    expect(paginateEvenly([], 16)).toEqual([]);
  });
});

describe('albumMetaLine', () => {
  it('joins year and genre', () => {
    expect(albumMetaLine(2026, 'Hard Rock')).toBe('2026  ·  Hard Rock');
  });

  it('leaves no stray separator when a part is missing', () => {
    expect(albumMetaLine(2026, undefined)).toBe('2026');
    expect(albumMetaLine(undefined, 'Doom Metal')).toBe('Doom Metal');
    expect(albumMetaLine(0, '  ')).toBe('');
    expect(albumMetaLine(null, null)).toBe('');
  });
});

describe('wrapText', () => {
  it('wraps at word boundaries without dropping any text', () => {
    const text = 'Rock and Roll Forever (50th Anniversary Super Deluxe Edition)';
    const lines = wrapText(text, 200, mono);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every(l => mono(l) <= 200)).toBe(true);
    expect(lines.join(' ')).toBe(text);
  });

  it('breaks a single word wider than the line and hyphenates it', () => {
    const word = 'Donaudampfschifffahrtsgesellschaftskapitänsmütze';
    const lines = wrapText(word, 150, mono);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every(l => mono(l) <= 150)).toBe(true);
    expect(lines.slice(0, -1).every(l => l.endsWith('-'))).toBe(true);
    expect(lines.map(l => l.replace(/-$/, '')).join('')).toBe(word);
  });

  it('does not hyphenate scripts without word spacing', () => {
    const text = '新着アルバムの長いタイトルがここにあります';
    const lines = wrapText(text, 60, mono);
    expect(lines.join('')).toBe(text);
    expect(lines.some(l => l.includes('-'))).toBe(false);
  });

  it('returns one empty line for empty text', () => {
    expect(wrapText('   ', 100, mono)).toEqual(['']);
  });
});
