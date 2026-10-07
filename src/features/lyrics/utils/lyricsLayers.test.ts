import { describe, expect, it } from 'vitest';
import type { LyricsTranslation } from '@/features/lyrics/types';
import {
  alignLyricsLayer,
  originalLyricsLines,
  pickLyricsTranslation,
} from '@/features/lyrics/utils/lyricsLayers';

const synced = originalLyricsLines(
  [
    { time: 1, text: 'first' },
    { time: 5, text: 'second' },
    { time: 9, text: 'third' },
  ],
  null,
  null,
);

describe('originalLyricsLines', () => {
  it('prefers word lines, then synced lines, then plain text', () => {
    const wordLines = [{ time: 2, duration: 1, text: 'word line', words: [] }];
    expect(originalLyricsLines([{ time: 1, text: 'synced' }], wordLines, 'plain')).toEqual({
      texts: ['word line'],
      times: [2],
    });
    expect(originalLyricsLines([{ time: 1, text: 'synced' }], null, 'plain')).toEqual({
      texts: ['synced'],
      times: [1],
    });
    expect(originalLyricsLines(null, null, 'a\nb')).toEqual({ texts: ['a', 'b'], times: null });
  });
});

describe('alignLyricsLayer', () => {
  it('matches timed lines by start time, whatever order they arrive in', () => {
    const layer = [
      { time: 9, text: 'dritte' },
      { time: 1, text: 'erste' },
      { time: 5, text: 'zweite' },
    ];
    expect(alignLyricsLayer(synced, layer, null)).toEqual(['erste', 'zweite', 'dritte']);
  });

  it('leaves a gap for a line the layer skips instead of shifting the rest', () => {
    // The middle line has no translation. Falling back to position would put
    // the third line's translation under the second line.
    const layer = [
      { time: 1, text: 'erste' },
      { time: 9, text: 'dritte' },
    ];
    expect(alignLyricsLayer(synced, layer, null)).toEqual(['erste', '', 'dritte']);
  });

  it('falls back to position when the layer has its own timing but every line', () => {
    const layer = [
      { time: 1.2, text: 'erste' },
      { time: 5.2, text: 'zweite' },
      { time: 9.2, text: 'dritte' },
    ];
    expect(alignLyricsLayer(synced, layer, null)).toEqual(['erste', 'zweite', 'dritte']);
  });

  it('aligns an untimed layer by position only when the line counts match', () => {
    const plain = originalLyricsLines(null, null, 'first\nsecond');
    expect(alignLyricsLayer(plain, null, 'erste\nzweite')).toEqual(['erste', 'zweite']);
    expect(alignLyricsLayer(plain, null, 'erste')).toBeNull();
  });

  it('drops lines identical to the original and returns null when nothing is left', () => {
    const layer = [
      { time: 1, text: 'first' },
      { time: 5, text: 'zweite' },
      { time: 9, text: 'third' },
    ];
    expect(alignLyricsLayer(synced, layer, null)).toEqual(['', 'zweite', '']);
    expect(alignLyricsLayer(synced, [{ time: 1, text: 'first' }], null)).toBeNull();
  });

  it('returns null without a layer', () => {
    expect(alignLyricsLayer(synced, null, null)).toBeNull();
    expect(alignLyricsLayer(synced, [], null)).toBeNull();
  });
});

describe('pickLyricsTranslation', () => {
  const layer = (lang: string): LyricsTranslation => ({ lang, lines: null, plainLyrics: lang });

  it('prefers the app language, matching on the primary subtag', () => {
    const translations = [layer('en'), layer('de-de'), layer('zh-hans')];
    expect(pickLyricsTranslation(translations, 'de')?.lang).toBe('de-de');
    expect(pickLyricsTranslation(translations, 'zh')?.lang).toBe('zh-hans');
  });

  it('falls back to the first translation when none is in the app language', () => {
    expect(pickLyricsTranslation([layer('en'), layer('fr')], 'ja')?.lang).toBe('en');
  });

  it('returns null when there are no translations', () => {
    expect(pickLyricsTranslation([], 'en')).toBeNull();
  });
});
