import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WordLyricsLine } from '@/features/lyrics/types';

const playback = vi.hoisted(() => ({
  time: 0,
  listener: null as ((seconds: number) => void) | null,
}));

vi.mock('@/features/playback', () => ({
  getSmoothPlaybackTime: () => playback.time,
  subscribeSmoothPlaybackTime: (listener: (seconds: number) => void) => {
    playback.listener = listener;
    return () => { playback.listener = null; };
  },
}));

import { useWordLyricsSync } from './useWordLyricsSync';

const lines: WordLyricsLine[] = [
  {
    time: 1,
    duration: 3,
    text: '君の',
    words: [
      { text: '君', time: 1, duration: 1 },
      { text: 'の', time: 2, duration: 1 },
    ],
  },
  {
    time: 5,
    duration: 2,
    text: '名は',
    words: [{ text: '名は', time: 5, duration: 2 }],
  },
];

beforeEach(() => {
  playback.time = 1.5;
  playback.listener = null;
});

describe('useWordLyricsSync romanization progress', () => {
  it('tracks the same timed word across the pronunciation overlay', () => {
    const { result } = renderHook(() => useWordLyricsSync({
      enabled: true,
      wordLines: lines,
      currentTrack: null,
      classPrefix: 'fsa',
    }));
    const first = document.createElement('span');
    const second = document.createElement('span');

    act(() => {
      result.current.setRomanizationRef(0)(first);
      result.current.setRomanizationRef(1)(second);
    });
    expect(first).toHaveClass('active');
    expect(first.style.getPropertyValue('--lyrics-romanization-progress')).toBe('50%');
    expect(second).not.toHaveClass('active', 'played');

    act(() => playback.listener?.(2.5));
    expect(first.style.getPropertyValue('--lyrics-romanization-progress')).toBe('100%');

    act(() => playback.listener?.(5.2));
    expect(first).toHaveClass('played');
    expect(second).toHaveClass('active');
    expect(second.style.getPropertyValue('--lyrics-romanization-progress')).toBe('100%');
  });
});
