import type { WordLyricsLine } from '@/features/lyrics/types';
import type { LyricsWordHighlightMode } from '@/store/authStoreTypes';

export interface WordLyricsPosition {
  lineIndex: number;
  wordIndex: number;
  wordProgress: number;
}

function clampProgress(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function usesContinuousWordHighlight(mode: LyricsWordHighlightMode): boolean {
  return mode !== 'step';
}

export function wordHighlightClassName(
  baseClass: string,
  mode: LyricsWordHighlightMode,
): string {
  if (mode === 'step') return baseClass;
  return `${baseClass} smooth-mode${mode === 'flowing' ? ' flow-only' : ''}`;
}

export function wordLyricsPositionAt(
  lines: readonly WordLyricsLine[],
  time: number,
): WordLyricsPosition {
  let lineIndex = -1;
  for (let index = 0; index < lines.length; index++) {
    if (time >= lines[index].time) lineIndex = index;
    else break;
  }

  if (lineIndex < 0) return { lineIndex, wordIndex: -1, wordProgress: 0 };

  const line = lines[lineIndex];
  let wordIndex = -1;
  for (let index = 0; index < line.words.length; index++) {
    if (time >= line.words[index].time) wordIndex = index;
    else break;
  }

  if (wordIndex < 0) return { lineIndex, wordIndex, wordProgress: 0 };

  const word = line.words[wordIndex];
  const nextWordTime = line.words[wordIndex + 1]?.time;
  const lineEnd = line.time + line.duration;
  const wordEnd = word.time + word.duration;
  const endTime = nextWordTime !== undefined && nextWordTime > word.time
    ? nextWordTime
    : word.duration > 0
      ? wordEnd
      : lineEnd > word.time
        ? lineEnd
        : word.time;
  const wordProgress = endTime > word.time
    ? clampProgress((time - word.time) / (endTime - word.time))
    : 1;

  return { lineIndex, wordIndex, wordProgress };
}

export function setWordHighlight(
  element: HTMLSpanElement | undefined,
  baseClass: string,
  state: 'upcoming' | 'active' | 'played',
  smooth: boolean,
  progress = 0,
): void {
  if (!element) return;
  element.className = state === 'upcoming'
    ? baseClass
    : `${baseClass} ${state}`;
  if (smooth) {
    const stateProgress = state === 'played' ? 1 : state === 'active' ? progress : 0;
    const percent = Math.round(clampProgress(stateProgress) * 10_000) / 100;
    element.style.setProperty('--lyrics-word-progress', `${percent}%`);
  } else {
    element.style.removeProperty('--lyrics-word-progress');
  }
}
