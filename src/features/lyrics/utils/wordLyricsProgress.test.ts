import { describe, expect, it } from 'vitest';
import type { WordLyricsLine } from '@/features/lyrics/types';
import { wordHighlightClassName, wordLyricsPositionAt } from './wordLyricsProgress';

const lines: WordLyricsLine[] = [
  {
    time: 1,
    duration: 4,
    text: '君の名は',
    words: [
      { text: '君', time: 1, duration: 5 },
      { text: 'の', time: 2, duration: 0 },
      { text: '名は', time: 3, duration: 2 },
    ],
  },
];

describe('wordLyricsPositionAt', () => {
  it('returns continuous progress through the current timed word', () => {
    expect(wordLyricsPositionAt(lines, 1.25)).toEqual({
      lineIndex: 0,
      wordIndex: 0,
      wordProgress: 0.25,
    });
    expect(wordLyricsPositionAt(lines, 1.75).wordProgress).toBe(0.75);
  });

  it('falls back to the next word timestamp when duration is unavailable', () => {
    expect(wordLyricsPositionAt(lines, 2.5)).toEqual({
      lineIndex: 0,
      wordIndex: 1,
      wordProgress: 0.5,
    });
  });

  it('clamps a word at fully played after its duration', () => {
    expect(wordLyricsPositionAt(lines, 5).wordProgress).toBe(1);
  });
});

describe('wordHighlightClassName', () => {
  it('keeps the existing modes unchanged and marks flowing-only highlighting', () => {
    expect(wordHighlightClassName('lyrics-word', 'step')).toBe('lyrics-word');
    expect(wordHighlightClassName('lyrics-word', 'smooth')).toBe('lyrics-word smooth-mode');
    expect(wordHighlightClassName('lyrics-word', 'flowing')).toBe(
      'lyrics-word smooth-mode flow-only',
    );
  });
});
