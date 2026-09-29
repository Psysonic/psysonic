import { useEffect, useRef } from 'react';
import { getSmoothPlaybackTime, subscribeSmoothPlaybackTime } from '@/features/playback';
import type { Track } from '@/lib/media/trackTypes';
import type { WordLyricsLine } from '@/features/lyrics/types';
import type { LyricsWordHighlightMode } from '@/store/authStoreTypes';
import {
  romanizationProgressForWord,
  setRomanizationProgress,
} from '@/features/lyrics/utils/romanizationProgress';
import {
  setWordHighlight,
  usesContinuousWordHighlight,
  wordHighlightClassName,
  wordLyricsPositionAt,
} from '@/features/lyrics/utils/wordLyricsProgress';

interface Args {
  enabled: boolean;
  wordLines: WordLyricsLine[] | null;
  currentTrack: Track | null;
  /** CSS class prefix — `fsa` for Apple Music view, `fsr` for rail view. */
  classPrefix: 'fsa' | 'fsr';
  highlightMode: LyricsWordHighlightMode;
}

/** Imperative word-sync DOM updates — toggles the per-word `<span>` classes
 *  (`<prefix>-lyric-word`, ` played`, ` active`) from a single playback-progress
 *  subscription without re-rendering React on every tick. Returns the ref array
 *  the consumer attaches to each word span. */
export function useWordLyricsSync({
  enabled,
  wordLines,
  currentTrack,
  classPrefix,
  highlightMode,
}: Args) {
  const wordRefs = useRef<HTMLSpanElement[][]>([]);
  const romanizationRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const prevWord = useRef<{ line: number; word: number; progress: number }>({
    line: -1,
    word: -1,
    progress: 0,
  });

  useEffect(() => {
    wordRefs.current = [];
    romanizationRefs.current = [];
    prevWord.current = { line: -1, word: -1, progress: 0 };
  }, [currentTrack?.id, enabled]);

  useEffect(() => {
    if (!enabled || !wordLines) return;
    const lines = wordLines;
    const smooth = usesContinuousWordHighlight(highlightMode);
    const baseClass = wordHighlightClassName(`${classPrefix}-lyric-word`, highlightMode);
    let refreshHighlightMode = true;
    const apply = (time: number) => {
      const { lineIndex: li, wordIndex: wi, wordProgress } = wordLyricsPositionAt(lines, time);
      const prev = prevWord.current;
      if (prev.line === li && prev.word === wi) {
        if ((smooth || refreshHighlightMode) && li >= 0 && wi >= 0) {
          setWordHighlight(wordRefs.current[li]?.[wi], baseClass, 'active', smooth, wordProgress);
          setRomanizationProgress(
            romanizationRefs.current[li],
            'active',
            romanizationProgressForWord(lines[li].words.length, wi, smooth ? wordProgress : 1),
          );
        }
        prevWord.current = { line: li, word: wi, progress: wordProgress };
        refreshHighlightMode = false;
        return;
      }
      if (prev.line < 0) {
        for (let i = 0; i < romanizationRefs.current.length; i++) {
          setRomanizationProgress(
            romanizationRefs.current[i],
            i < li ? 'played' : i === li ? 'active' : 'upcoming',
            i < li
              ? 100
              : i === li
                ? romanizationProgressForWord(lines[i]?.words.length ?? 0, wi, smooth ? wordProgress : 1)
                : 0,
          );
        }
      }
      if (prev.line !== li && prev.line >= 0) {
        for (const word of wordRefs.current[prev.line] ?? []) {
          setWordHighlight(word, baseClass, 'upcoming', false);
        }
        setRomanizationProgress(romanizationRefs.current[prev.line], 'played', 100);
      }
      if (li >= 0 && wordRefs.current[li]) {
        const ws = wordRefs.current[li];
        for (let j = 0; j < ws.length; j++) {
          setWordHighlight(
            ws[j],
            baseClass,
            j < wi ? 'played' : j === wi ? 'active' : 'upcoming',
            smooth,
            j === wi ? wordProgress : 0,
          );
        }
      }
      if (li >= 0) {
        setRomanizationProgress(
          romanizationRefs.current[li],
          'active',
          romanizationProgressForWord(lines[li].words.length, wi, smooth ? wordProgress : 1),
        );
      }
      prevWord.current = { line: li, word: wi, progress: wordProgress };
      refreshHighlightMode = false;
    };
    apply(getSmoothPlaybackTime());
    return subscribeSmoothPlaybackTime(apply);
  }, [enabled, wordLines, classPrefix, highlightMode]);

  const setWordRef = (lineIdx: number, wordIdx: number) => (el: HTMLSpanElement | null) => {
    if (!wordRefs.current[lineIdx]) wordRefs.current[lineIdx] = [];
    if (el) wordRefs.current[lineIdx][wordIdx] = el;
  };

  const setRomanizationRef = (lineIdx: number) => (element: HTMLSpanElement | null) => {
    romanizationRefs.current[lineIdx] = element;
    if (!element || !enabled || !wordLines) return;
    const current = prevWord.current;
    setRomanizationProgress(
      element,
      lineIdx < current.line ? 'played' : lineIdx === current.line ? 'active' : 'upcoming',
      lineIdx < current.line
        ? 100
        : lineIdx === current.line
          ? romanizationProgressForWord(
              wordLines[lineIdx]?.words.length ?? 0,
              current.word,
              usesContinuousWordHighlight(highlightMode) ? current.progress : 1,
            )
          : 0,
    );
  };

  return { setWordRef, setRomanizationRef };
}
