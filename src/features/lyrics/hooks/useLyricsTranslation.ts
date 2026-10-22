import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LrcLine, LyricsTranslation, WordLyricsLine } from '@/features/lyrics/types';
import {
  alignLyricsLayer,
  originalLyricsLines,
  pickLyricsTranslation,
} from '@/features/lyrics/utils/lyricsLayers';

interface UseLyricsTranslationOptions {
  enabled: boolean;
  syncedLines: LrcLine[] | null;
  wordLines: WordLyricsLine[] | null;
  plainLyrics: string | null;
  translations: readonly LyricsTranslation[];
}

/**
 * The translated line for each original line, or null when translations are
 * off or the lyrics carry none. Prefers the app language among several.
 */
export function useLyricsTranslation({
  enabled,
  syncedLines,
  wordLines,
  plainLyrics,
  translations,
}: UseLyricsTranslationOptions): string[] | null {
  const { i18n } = useTranslation();
  const appLanguage = i18n.language ?? '';
  const original = useMemo(
    () => originalLyricsLines(syncedLines, wordLines, plainLyrics),
    [plainLyrics, syncedLines, wordLines],
  );
  const translation = useMemo(
    () => pickLyricsTranslation(translations, appLanguage),
    [translations, appLanguage],
  );
  return useMemo(() => {
    if (!enabled || !translation) return null;
    return alignLyricsLayer(original, translation.lines, translation.plainLyrics);
  }, [enabled, original, translation]);
}
