/**
 * Secondary lyric layers — pronunciation and translation — render as an extra
 * line beneath each original line. These helpers line a layer up with the
 * original text; the hooks that produce those lines share them.
 */
import type { LrcLine, LyricsTranslation, WordLyricsLine } from '@/features/lyrics/types';

export interface OriginalLyricsLines {
  texts: string[];
  /** Start of each line in seconds, or null for unsynced lyrics. */
  times: number[] | null;
}

/** The original lines in the order the lyrics views render them. */
export function originalLyricsLines(
  syncedLines: LrcLine[] | null,
  wordLines: WordLyricsLine[] | null,
  plainLyrics: string | null,
): OriginalLyricsLines {
  if (wordLines?.length) {
    return { texts: wordLines.map(line => line.text), times: wordLines.map(line => line.time) };
  }
  if (syncedLines?.length) {
    return { texts: syncedLines.map(line => line.text), times: syncedLines.map(line => line.time) };
  }
  return { texts: plainLyrics?.split('\n') ?? [], times: null };
}

/**
 * One entry per original line, '' where the layer has nothing to add.
 *
 * Timed layer lines are matched by start time: the server copies the original
 * line's start onto the layer line that belongs to it. Position is only the
 * fallback, and only when the layer has exactly as many lines as the original —
 * a layer that skips lines (an ad-lib left untranslated) would otherwise slide
 * every later entry onto the wrong line.
 *
 * Entries identical to their original line are dropped so nothing shows twice.
 */
export function alignLyricsLayer(
  original: OriginalLyricsLines,
  layerLines: readonly LrcLine[] | null,
  layerPlainLyrics: string | null,
): string[] | null {
  const lineCount = original.texts.length;
  let aligned: string[];

  if (layerLines?.length) {
    const byTime = new Map(layerLines.map(line => [Math.round(line.time * 1000), line.text]));
    const byPosition = layerLines.length === lineCount;
    aligned = original.texts.map((_, index) => {
      const time = original.times?.[index];
      return (time !== undefined ? byTime.get(Math.round(time * 1000)) : undefined)
        ?? (byPosition ? layerLines[index].text : '');
    });
  } else if (layerPlainLyrics) {
    const lines = layerPlainLyrics.split('\n');
    if (lines.length !== lineCount) return null;
    aligned = lines;
  } else {
    return null;
  }

  const distinct = aligned.map((line, index) => (
    line.trim() && line.trim() !== original.texts[index]?.trim() ? line.trim() : ''
  ));
  return distinct.some(Boolean) ? distinct : null;
}

/** Primary language subtag, lower-case: `en-US` and `en_us` both give `en`. */
function primaryLanguage(code: string): string {
  return code.trim().toLowerCase().split(/[-_]/)[0];
}

/** The translation in the app language when there is one, else the first the server sent. */
export function pickLyricsTranslation(
  translations: readonly LyricsTranslation[],
  appLanguage: string,
): LyricsTranslation | null {
  if (translations.length === 0) return null;
  const wanted = primaryLanguage(appLanguage);
  return translations.find(translation => primaryLanguage(translation.lang) === wanted)
    ?? translations[0];
}
