import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  getSmoothPlaybackTime,
  subscribeSmoothPlaybackTime,
  usePlayerStore,
} from '@/features/playback';
import { useAuthStore } from '@/store/authStore';
import {
  LyricsLineContent,
  LyricsZoomControls,
  useLyricsZoomKeyboard,
  useLyricsAppearance,
  useLyricsRailLayout,
  useLyrics,
  useLyricsRomanization,
  useLyricsTranslation,
  type WordLyricsLine,
  useWordLyricsSync,
  wordHighlightClassName,
} from '@/features/lyrics';
import type { LrcLine } from '@/features/lyrics';
import type { Track } from '@/lib/media/trackTypes';

// Classic 5-line rail lyrics (original "Rail" style).
// Rows retain a 6vh minimum; measured offsets also support wrapped/zoomed text.
export const FsLyricsRail = memo(function FsLyricsRail({ currentTrack }: { currentTrack: Track | null }) {
  const appearance = useLyricsAppearance();
  const { romanizationPrimary, appearanceRef, appearanceStyle } = appearance;
  const keyboardRef = useLyricsZoomKeyboard(true);
  const {
    syncedLines,
    wordLines,
    plainLyrics,
    pronunciationLines,
    pronunciationPlainLyrics,
    translations,
    loading,
  } = useLyrics(currentTrack);
  const staticOnly = useAuthStore(s => s.lyricsStaticOnly);
  const romanizationEnabled = useAuthStore(s => s.lyricsRomanizationEnabled);
  const translationEnabled = useAuthStore(s => s.lyricsTranslationEnabled);
  const wordHighlightMode = useAuthStore(s => s.lyricsWordHighlightMode);
  const wordClass = wordHighlightClassName('fsr-lyric-word', wordHighlightMode);

  const useWords  = !staticOnly && wordLines !== null && wordLines.length > 0;
  const lineSrc: LrcLine[] | null = useWords
    ? (wordLines as WordLyricsLine[]).map(l => ({ time: l.time, text: l.text }))
    : (syncedLines as LrcLine[] | null);
  const hasSynced = !staticOnly && lineSrc !== null && lineSrc.length > 0;
  const romanizedLines = useLyricsRomanization({
    enabled: romanizationEnabled,
    syncedLines,
    wordLines,
    plainLyrics,
    pronunciationLines,
    pronunciationPlainLyrics,
  });
  const translatedLines = useLyricsTranslation({
    enabled: translationEnabled,
    syncedLines,
    wordLines,
    plainLyrics,
    translations,
  });

  const linesRef = useRef<LrcLine[]>([]);
  linesRef.current = hasSynced ? lineSrc! : [];

  // The store's currentTime is committed at 20 s / 5 s granularity, which is
  // far too coarse to pick a lyric line — the per-word highlighting in this
  // same view already runs off the interpolated position, so the rail followed
  // several seconds behind its own words. Both read the same clock now.
  const [activeIdx, setActiveIdx] = useState(-1);
  const activeIdxRef = useRef(-1);
  useEffect(() => {
    const apply = (time: number) => {
      const ls = linesRef.current;
      let idx = -1;
      for (let i = 0; i < ls.length; i++) {
        if (time >= ls[i].time) idx = i;
        else break;
      }
      if (idx === activeIdxRef.current) return;
      activeIdxRef.current = idx;
      setActiveIdx(idx);
    };
    apply(getSmoothPlaybackTime());
    return subscribeSmoothPlaybackTime(apply);
    // Same deps as the Apple style: the lines arrive asynchronously, and while
    // paused no progress event ever lands, so without these the rail would
    // stay unhighlighted until playback resumes.
  }, [hasSynced, currentTrack?.id]);

  const duration = usePlayerStore(s => s.currentTrack?.duration ?? 0);
  const seek     = usePlayerStore(s => s.seek);

  const overlayRef = useLyricsRailLayout(activeIdx);
  const setOverlayRef = useCallback((node: HTMLDivElement | null) => {
    overlayRef.current = node;
    appearanceRef(node);
  }, [overlayRef, appearanceRef]);

  const handleLineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-time]');
    if (!target || duration <= 0) return;
    seek(parseFloat(target.dataset.time!) / duration);
  }, [duration, seek]);

  const { setWordRef, setRomanizationRef } = useWordLyricsSync({
    enabled: useWords,
    wordLines: useWords ? (wordLines as WordLyricsLine[]) : null,
    currentTrack,
    classPrefix: 'fsr',
    highlightMode: wordHighlightMode,
  });

  if (!currentTrack || loading || !hasSynced) return null;

  return (
    <div className="fsr-lyrics-surface" ref={keyboardRef}>
      <LyricsZoomControls {...appearance} />
    <div className="fsr-lyrics-overlay" ref={setOverlayRef} style={appearanceStyle} aria-hidden="true">
      <div
        className="fsr-lyrics-rail"
        onClick={handleLineClick}
      >
        {useWords
          ? (wordLines as WordLyricsLine[]).map((line, i) => (
              <div
                key={i}
                className={`fsr-lyric-line${i === activeIdx ? ' fsrl-active' : i < activeIdx ? ' fsrl-past' : ''}`}
                data-time={line.time}
              >
                <LyricsLineContent
                  romanizationPrimary={romanizationPrimary}
                  romanization={romanizedLines?.[i]}
                  romanizationRef={setRomanizationRef(i)}
                  translation={translatedLines?.[i]}
                >
                  {line.words.length > 0 ? line.words.map((w, j) => (
                    <span
                      key={j}
                      className={wordClass}
                      ref={setWordRef(i, j)}
                    >{w.text}</span>
                  )) : (line.text || ' ')}
                </LyricsLineContent>
              </div>
            ))
          : lineSrc!.map((line, i) => (
              <div
                key={i}
                className={`fsr-lyric-line${i === activeIdx ? ' fsrl-active' : i < activeIdx ? ' fsrl-past' : ''}`}
                data-time={line.time}
              >
                <LyricsLineContent romanizationPrimary={romanizationPrimary} romanization={romanizedLines?.[i]} translation={translatedLines?.[i]}>
                  {line.text || ' '}
                </LyricsLineContent>
              </div>
            ))}
      </div>
    </div>
    </div>
  );
});
