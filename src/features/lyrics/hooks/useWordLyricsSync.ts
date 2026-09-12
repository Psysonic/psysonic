import { useEffect, useRef } from 'react';
import { getSmoothPlaybackTime, subscribeSmoothPlaybackTime } from '@/features/playback';
import type { Track } from '@/lib/media/trackTypes';
import type { WordLyricsLine } from '@/features/lyrics/types';
import {
  romanizationProgressForWord,
  setRomanizationProgress,
} from '@/features/lyrics/utils/romanizationProgress';

interface Args {
  enabled: boolean;
  wordLines: WordLyricsLine[] | null;
  currentTrack: Track | null;
  /** CSS class prefix — `fsa` for Apple Music view, `fsr` for rail view. */
  classPrefix: 'fsa' | 'fsr';
}

/** Imperative word-sync DOM updates — toggles the per-word `<span>` classes
 *  (`<prefix>-lyric-word`, ` played`, ` active`) from a single playback-progress
 *  subscription without re-rendering React on every tick. Returns the ref array
 *  the consumer attaches to each word span. */
export function useWordLyricsSync({ enabled, wordLines, currentTrack, classPrefix }: Args) {
  const wordRefs = useRef<HTMLSpanElement[][]>([]);
  const romanizationRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const prevWord = useRef<{ line: number; word: number }>({ line: -1, word: -1 });

  useEffect(() => {
    wordRefs.current = [];
    romanizationRefs.current = [];
    prevWord.current = { line: -1, word: -1 };
  }, [currentTrack?.id, enabled]);

  useEffect(() => {
    if (!enabled || !wordLines) return;
    const lines = wordLines;
    const baseClass = `${classPrefix}-lyric-word`;
    const apply = (time: number) => {
      let li = -1;
      for (let i = 0; i < lines.length; i++) { if (time >= lines[i].time) li = i; else break; }
      let wi = -1;
      if (li >= 0) {
        const ws = lines[li].words;
        for (let j = 0; j < ws.length; j++) { if (time >= ws[j].time) wi = j; else break; }
      }
      const prev = prevWord.current;
      if (prev.line === li && prev.word === wi) return;
      if (prev.line < 0) {
        for (let i = 0; i < romanizationRefs.current.length; i++) {
          setRomanizationProgress(
            romanizationRefs.current[i],
            i < li ? 'played' : i === li ? 'active' : 'upcoming',
            i < li ? 100 : i === li ? romanizationProgressForWord(lines[i]?.words.length ?? 0, wi) : 0,
          );
        }
      }
      if (prev.line !== li && prev.line >= 0) {
        for (const w of wordRefs.current[prev.line] ?? []) w.className = baseClass;
        setRomanizationProgress(romanizationRefs.current[prev.line], 'played', 100);
      }
      if (li >= 0 && wordRefs.current[li]) {
        const ws = wordRefs.current[li];
        for (let j = 0; j < ws.length; j++) {
          ws[j].className = j < wi ? `${baseClass} played` : j === wi ? `${baseClass} active` : baseClass;
        }
      }
      if (li >= 0) {
        setRomanizationProgress(
          romanizationRefs.current[li],
          'active',
          romanizationProgressForWord(lines[li].words.length, wi),
        );
      }
      prevWord.current = { line: li, word: wi };
    };
    apply(getSmoothPlaybackTime());
    return subscribeSmoothPlaybackTime(apply);
  }, [enabled, wordLines, classPrefix]);

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
          ? romanizationProgressForWord(wordLines[lineIdx]?.words.length ?? 0, current.word)
          : 0,
    );
  };

  return { setWordRef, setRomanizationRef };
}
