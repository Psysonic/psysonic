import { getSmoothPlaybackTime, subscribeSmoothPlaybackTime } from '@/features/playback';
import { RotateCcw } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import type { LrcLine } from '@/features/lyrics/types';
import { useLyrics } from '@/features/lyrics/hooks/useLyrics';
import type { WordLyricsLine } from '@/features/lyrics/types';
import { useAuthStore } from '@/store/authStore';
import { useTranslation } from 'react-i18next';
import type { Track } from '@/lib/media/trackTypes';
import { EaseScroller, targetForFraction } from '@/lib/dom/easeScroll';
import OverlayScrollArea from '@/ui/OverlayScrollArea';
import { LyricsLineContent } from '@/features/lyrics/components/LyricsLineContent';
import { useLyricsRomanization } from '@/features/lyrics/hooks/useLyricsRomanization';
import {
  romanizationProgressForWord,
  setRomanizationProgress,
} from '@/features/lyrics/utils/romanizationProgress';

interface Props {
  currentTrack: Track | null;
}

/**
 * Apple Music-style scroll: active line scrolls to ~35% from top.
 * User scrolling pauses auto-scroll for 4 s then resumes.
 * Word-sync and line highlighting are imperative (no React re-renders per tick).
 */
export default function LyricsPane({ currentTrack }: Props) {
  const { t } = useTranslation();

  const {
    syncedLines,
    wordLines,
    plainLyrics,
    pronunciationLines,
    pronunciationPlainLyrics,
    source,
    loading,
    notFound,
    refresh,
  } = useLyrics(currentTrack);
  const { staticOnly, romanizationEnabled, sidebarLyricsStyle, lyricsSources } = useAuthStore(useShallow(s => ({
    staticOnly: s.lyricsStaticOnly,
    romanizationEnabled: s.lyricsRomanizationEnabled,
    sidebarLyricsStyle: s.sidebarLyricsStyle,
    lyricsSources: s.lyricsSources,
  })));
  // Lyrics fully off: no source enabled (issue #810).
  const lyricsDisabled = !lyricsSources.some(s => s.enabled);

  const useWords  = !staticOnly && wordLines !== null && wordLines.length > 0;
  const hasSynced = !staticOnly && !useWords && syncedLines !== null && syncedLines.length > 0;
  const romanizedLines = useLyricsRomanization({
    enabled: romanizationEnabled,
    syncedLines,
    wordLines,
    plainLyrics,
    pronunciationLines,
    pronunciationPlainLyrics,
  });

  const seek     = usePlayerStore(s => s.seek);
  const duration = usePlayerStore(s => s.currentTrack?.duration ?? 0);

  const containerRef  = useRef<HTMLDivElement | null>(null);
  const scrollerRef   = useRef<EaseScroller | null>(null);
  const lineRefs      = useRef<(HTMLDivElement | null)[]>([]);
  const wordRefs      = useRef<HTMLSpanElement[][]>([]);
  const romanizationRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const prevActive    = useRef({ line: -1, word: -1 });
  const prevTrackId   = useRef<string | null | undefined>(undefined);
  const isUserScroll  = useRef(false);
  const scrollTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    scrollerRef.current?.stop();
    scrollerRef.current = el ? new EaseScroller(el) : null;
  }, []);

  const handleUserScroll = useCallback(() => {
    scrollerRef.current?.stop();
    isUserScroll.current = true;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => { isUserScroll.current = false; }, 4000);
  }, []);

  const scrollToLine = useCallback((el: HTMLDivElement, immediate = false) => {
    if (isUserScroll.current) return;
    const container = containerRef.current;
    if (!container) return;
    if (immediate && scrollerRef.current) {
      scrollerRef.current.jump(targetForFraction(container, el, sidebarLyricsStyle === 'apple' ? 0.35 : 0.5));
      return;
    }
    if (sidebarLyricsStyle === 'apple' && scrollerRef.current) {
      scrollerRef.current.scrollTo(targetForFraction(container, el, 0.35));
    } else {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [sidebarLyricsStyle]);

  // Reset refs on actual track change. Skip the initial mount so we don't wipe
  // the callback-refs that the commit phase just populated — that would leave
  // the tracker effect with an empty lineRefs and freeze the highlight.
  useEffect(() => {
    const id = currentTrack?.id ?? null;
    if (prevTrackId.current !== undefined && prevTrackId.current !== id) {
      lineRefs.current = [];
      wordRefs.current = [];
      romanizationRefs.current = [];
      prevActive.current = { line: -1, word: -1 };
      scrollerRef.current?.jump(0);
    }
    prevTrackId.current = id;
  }, [currentTrack?.id]);

  // Imperative tracker — subscribes directly to the store, zero React re-renders per tick.
  useEffect(() => {
    if (!useWords && !hasSynced) return;

    const apply = (time: number) => {
      const lines = useWords ? (wordLines as WordLyricsLine[]) : (syncedLines as LrcLine[]);
      let lineIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (time >= lines[i].time) lineIdx = i;
        else break;
      }

      let wordIdx = -1;
      if (useWords && lineIdx >= 0) {
        const words = (wordLines as WordLyricsLine[])[lineIdx].words;
        for (let j = 0; j < words.length; j++) {
          if (time >= words[j].time) wordIdx = j;
          else break;
        }
      }

      const prev = prevActive.current;
      if (prev.line === lineIdx && prev.word === wordIdx) return;

      if (prev.line < 0) {
        for (let i = 0; i < lineRefs.current.length; i++) {
          const line = lineRefs.current[i];
          if (line) line.className = lineClass(i, lineIdx);
          setRomanizationProgress(
            romanizationRefs.current[i],
            i < lineIdx ? 'played' : i === lineIdx ? 'active' : 'upcoming',
            i < lineIdx
              ? 100
              : i === lineIdx
                ? romanizationProgressForWord(
                    useWords ? (wordLines as WordLyricsLine[])[i]?.words.length ?? 0 : 0,
                    wordIdx,
                  )
                : 0,
          );
        }
      }

      if (prev.line !== lineIdx) {
        if (prev.line >= 0) {
          const el = lineRefs.current[prev.line];
          if (el) el.className = lineClass(prev.line, lineIdx);
          setRomanizationProgress(romanizationRefs.current[prev.line], 'played', 100);
        }
        if (lineIdx >= 0) {
          const el = lineRefs.current[lineIdx];
          if (el) {
            el.className = lineClass(lineIdx, lineIdx);
            scrollToLine(el, prev.line < 0);
          }
        }
        if (useWords && prev.line >= 0 && wordRefs.current[prev.line]) {
          for (const w of wordRefs.current[prev.line]) w.className = 'lyrics-word';
        }
      }

      if (useWords && lineIdx >= 0 && wordRefs.current[lineIdx]) {
        const ws = wordRefs.current[lineIdx];
        for (let j = 0; j < ws.length; j++) {
          ws[j].className = j < wordIdx ? 'lyrics-word played'
                          : j === wordIdx ? 'lyrics-word active'
                          : 'lyrics-word';
        }
      }
      if (useWords && lineIdx >= 0) {
        setRomanizationProgress(
          romanizationRefs.current[lineIdx],
          'active',
          romanizationProgressForWord((wordLines as WordLyricsLine[])[lineIdx].words.length, wordIdx),
        );
      }

      prevActive.current = { line: lineIdx, word: wordIdx };
    };

    apply(getSmoothPlaybackTime());
    return subscribeSmoothPlaybackTime(apply);
  }, [useWords, hasSynced, wordLines, syncedLines, scrollToLine]);

  useLayoutEffect(() => {
    if (!romanizedLines) return;
    const frame = requestAnimationFrame(() => {
      const activeLine = lineRefs.current[prevActive.current.line];
      if (activeLine) scrollToLine(activeLine, true);
    });
    return () => cancelAnimationFrame(frame);
  }, [romanizedLines, scrollToLine]);

  const setRomanizationRef = useCallback((lineIndex: number) => (element: HTMLSpanElement | null) => {
    romanizationRefs.current[lineIndex] = element;
    if (!element || !useWords) return;
    const current = prevActive.current;
    setRomanizationProgress(
      element,
      lineIndex < current.line ? 'played' : lineIndex === current.line ? 'active' : 'upcoming',
      lineIndex < current.line
        ? 100
        : lineIndex === current.line
          ? romanizationProgressForWord(
              (wordLines as WordLyricsLine[])[lineIndex]?.words.length ?? 0,
              current.word,
            )
          : 0,
    );
  }, [useWords, wordLines]);

  if (!currentTrack) {
    return (
      <div className="lyrics-pane-empty">
        <p className="lyrics-status">{t('player.lyricsNotFound')}</p>
      </div>
    );
  }

  if (lyricsDisabled) {
    return (
      <div className="lyrics-pane-empty">
        <p className="lyrics-status">{t('player.lyricsNoSources')}</p>
      </div>
    );
  }

  const sourceLabel = source === 'server'
    ? t('player.lyricsSourceServer')
    : source === 'lrclib'
      ? t('player.lyricsSourceLrclib')
      : source === 'netease'
        ? t('player.lyricsSourceNetease')
        : null;

  const renderAsStatic = staticOnly && (
    (syncedLines !== null && syncedLines.length > 0) ||
    (wordLines !== null && wordLines.length > 0)
  );

  return (
    <div className="lyrics-pane-wrap">
      <OverlayScrollArea
        className="lyrics-pane"
        viewportClassName="lyrics-pane__viewport"
        viewportRef={setContainerRef}
        measureDeps={[
          currentTrack?.id,
          loading,
          notFound,
          source,
          useWords,
          hasSynced,
          staticOnly,
          sidebarLyricsStyle,
          plainLyrics?.length ?? 0,
          syncedLines?.length ?? 0,
          wordLines?.length ?? 0,
          romanizedLines?.filter(Boolean).length ?? 0,
        ]}
        railInset="panel"
        viewportOnWheel={handleUserScroll}
        viewportOnTouchMove={handleUserScroll}
      >
        {loading && <p className="lyrics-status">{t('player.lyricsLoading')}</p>}
        {notFound && !loading && <p className="lyrics-status">{t('player.lyricsNotFound')}</p>}

        {useWords && (
          <div className="lyrics-synced lyrics-word-synced">
            {(wordLines as WordLyricsLine[]).map((line, i) => (
              <div
                key={i}
                ref={el => { lineRefs.current[i] = el; }}
                className="lyrics-line"
                onClick={() => { if (duration > 0) seek(line.time / duration); }}
                style={{ cursor: 'pointer' }}
              >
                <LyricsLineContent
                  romanization={romanizedLines?.[i]}
                  romanizationRef={setRomanizationRef(i)}
                >
                  {line.words.length > 0 ? line.words.map((w, j) => (
                    <span
                      key={j}
                      className="lyrics-word"
                      ref={el => {
                        if (!wordRefs.current[i]) wordRefs.current[i] = [];
                        if (el) wordRefs.current[i][j] = el;
                      }}
                    >
                      {w.text}
                    </span>
                  )) : (line.text || '\u00A0')}
                </LyricsLineContent>
              </div>
            ))}
          </div>
        )}

        {hasSynced && !useWords && (
          <div className="lyrics-synced">
            {(syncedLines as LrcLine[]).map((line, i) => (
              <div
                key={i}
                ref={el => { lineRefs.current[i] = el; }}
                className="lyrics-line"
                onClick={() => { if (duration > 0) seek(line.time / duration); }}
                style={{ cursor: 'pointer' }}
              >
                <LyricsLineContent romanization={romanizedLines?.[i]}>
                  {line.text || '\u00A0'}
                </LyricsLineContent>
              </div>
            ))}
          </div>
        )}

        {renderAsStatic && (
          <div className="lyrics-plain">
            {((syncedLines ?? []).length > 0
              ? (syncedLines as LrcLine[]).map(l => l.text)
              : (wordLines as WordLyricsLine[]).map(l => l.text)
            ).map((text, i) => (
              <p key={i} className="lyrics-plain-line">
                <LyricsLineContent romanization={romanizedLines?.[i]}>
                  {text || '\u00A0'}
                </LyricsLineContent>
              </p>
            ))}
          </div>
        )}

        {!renderAsStatic && !useWords && !hasSynced && plainLyrics && (
          <div className="lyrics-plain">
            {plainLyrics.split('\n').map((line, i) => (
              <p key={i} className="lyrics-plain-line">
                <LyricsLineContent romanization={romanizedLines?.[i]}>
                  {line || '\u00A0'}
                </LyricsLineContent>
              </p>
            ))}
          </div>
        )}

      </OverlayScrollArea>

      {/* Pinned below the scrolling text: the refresh action stays reachable
          without scrolling to the end of a long song, and the source label
          keeps its place directly under it. */}
      <div className="lyrics-pane-footer">
        <button
          type="button"
          className="lyrics-refresh-btn"
          onClick={refresh}
          disabled={loading}
        >
          <RotateCcw size={14} className={loading ? 'spin' : ''} aria-hidden="true" />
          <span>{t('player.lyricsRefresh')}</span>
        </button>
        {sourceLabel && !loading && !notFound && (
          <p className="lyrics-source">{sourceLabel}</p>
        )}
      </div>
    </div>
  );
}

function lineClass(i: number, active: number): string {
  const base = 'lyrics-line';
  if (i > active) return base;
  if (i < active) return `${base} completed`;
  return `${base} active`;
}
