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
      highlightMode: 'step',
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

  it('updates the active word fill while the timed word stays unchanged', () => {
    const { result, rerender } = renderHook(({ highlightMode }: { highlightMode: 'step' | 'smooth' }) => useWordLyricsSync({
      enabled: true,
      wordLines: lines,
      currentTrack: null,
      classPrefix: 'fsa',
      highlightMode,
    }), { initialProps: { highlightMode: 'smooth' } });
    const first = document.createElement('span');
    const second = document.createElement('span');
    const romanization = document.createElement('span');

    act(() => {
      result.current.setWordRef(0, 0)(first);
      result.current.setWordRef(0, 1)(second);
      result.current.setRomanizationRef(0)(romanization);
      playback.listener?.(1.5);
    });
    expect(first).toHaveClass('active', 'smooth-mode');
    expect(first.style.getPropertyValue('--lyrics-word-progress')).toBe('50%');
    expect(romanization.style.getPropertyValue('--lyrics-romanization-progress')).toBe('25%');

    act(() => playback.listener?.(1.75));
    expect(first.style.getPropertyValue('--lyrics-word-progress')).toBe('75%');
    expect(romanization.style.getPropertyValue('--lyrics-romanization-progress')).toBe('37.5%');

    act(() => playback.listener?.(2.25));
    expect(first).toHaveClass('played', 'smooth-mode');
    expect(first.style.getPropertyValue('--lyrics-word-progress')).toBe('100%');
    expect(second).toHaveClass('active', 'smooth-mode');
    expect(second.style.getPropertyValue('--lyrics-word-progress')).toBe('25%');
    expect(romanization.style.getPropertyValue('--lyrics-romanization-progress')).toBe('62.5%');

    playback.time = 2.25;
    rerender({ highlightMode: 'step' });
    expect(second).toHaveClass('active');
    expect(second).not.toHaveClass('smooth-mode');
    expect(second.style.getPropertyValue('--lyrics-word-progress')).toBe('');
    expect(romanization.style.getPropertyValue('--lyrics-romanization-progress')).toBe('100%');
  });
});
