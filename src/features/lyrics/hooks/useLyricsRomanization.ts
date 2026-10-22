import { useEffect, useMemo, useState } from 'react';
import type { LrcLine, WordLyricsLine } from '@/features/lyrics/types';
import { alignLyricsLayer, originalLyricsLines } from '@/features/lyrics/utils/lyricsLayers';
import type { KuroshiroAnalyzer } from 'kuroshiro';

const JAPANESE_KANA_RE = /[\u3040-\u30ff\uff66-\uff9f]/u;
/** Kana, CJK ideographs (incl. extension A) and the \u3005 iteration mark. */
const JAPANESE_SCRIPT_RE = /[\u3040-\u30ff\uff66-\uff9f\u3400-\u4dbf\u4e00-\u9fff\u3005]/u;
const ROMANIZATION_CACHE_LIMIT = 24;
const romanizationCache = new Map<string, Promise<string[] | null>>();

interface KuromojiToken {
  word_id: number;
  word_type: string;
  word_position: number;
  [key: string]: unknown;
}

interface KuromojiTokenizer {
  tokenize(text: string): KuromojiToken[];
}

interface KuromojiApi {
  builder(options: { dicPath: string }): {
    build(callback: (error: unknown, tokenizer: KuromojiTokenizer) => void): void;
  };
}

let kuromojiScriptPromise: Promise<KuromojiApi> | null = null;
let kuroshiroPromise: Promise<import('kuroshiro').default> | null = null;

function loadKuromojiBrowserBundle(): Promise<KuromojiApi> {
  const global = window as Window & { kuromoji?: KuromojiApi };
  if (global.kuromoji) return Promise.resolve(global.kuromoji);
  if (kuromojiScriptPromise) return kuromojiScriptPromise;

  const load = new Promise<KuromojiApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/assets/kuromoji/kuromoji.js';
    script.async = true;
    script.onload = () => {
      if (global.kuromoji) resolve(global.kuromoji);
      else reject(new Error('Kuromoji browser bundle did not initialise'));
    };
    script.onerror = () => reject(new Error('Failed to load Kuromoji browser bundle'));
    document.head.append(script);
  });
  kuromojiScriptPromise = load.catch(error => {
    kuromojiScriptPromise = null;
    throw error;
  });
  return kuromojiScriptPromise;
}

class BrowserKuromojiAnalyzer implements KuroshiroAnalyzer {
  private tokenizer: KuromojiTokenizer | null = null;

  async init(): Promise<void> {
    const kuromoji = await loadKuromojiBrowserBundle();
    this.tokenizer = await new Promise<KuromojiTokenizer>((resolve, reject) => {
      kuromoji.builder({ dicPath: '/assets/kuromoji/' }).build((error, tokenizer) => {
        if (error) reject(error);
        else resolve(tokenizer);
      });
    });
  }

  async parse(text = ''): Promise<unknown[]> {
    if (!text.trim()) return [];
    if (!this.tokenizer) throw new Error('Kuromoji analyzer is not initialised');
    return this.tokenizer.tokenize(text).map(token => {
      const { word_id, word_type, word_position, ...result } = token;
      return {
        ...result,
        verbose: { word_id, word_type, word_position },
      };
    });
  }
}

async function getKuroshiro(): Promise<import('kuroshiro').default> {
  if (!kuroshiroPromise) {
    kuroshiroPromise = (async () => {
      const { default: Kuroshiro } = await import('kuroshiro');
      const kuroshiro = new Kuroshiro();
      await kuroshiro.init(new BrowserKuromojiAnalyzer());
      return kuroshiro;
    })();
  }
  return kuroshiroPromise;
}

export function containsJapaneseKana(lines: readonly string[]): boolean {
  return lines.some(line => JAPANESE_KANA_RE.test(line));
}

export function romanizeJapaneseLines(lines: readonly string[]): Promise<string[] | null> {
  if (!containsJapaneseKana(lines)) return Promise.resolve(null);

  const key = lines.join('\u0000');
  const cached = romanizationCache.get(key);
  if (cached) return cached;

  const promise = (async () => {
    try {
      const kuroshiro = await getKuroshiro();
      const converted = await Promise.all(lines.map(async line => {
        // A line without Japanese script has nothing to romanize; the analyzer would
        // only re-space its punctuation and show it again underneath.
        if (!JAPANESE_SCRIPT_RE.test(line)) return '';
        const value = (await kuroshiro.convert(line, {
          mode: 'spaced',
          to: 'romaji',
          romajiSystem: 'hepburn',
        })).trim();
        return value && value !== line.trim() ? value : '';
      }));
      return converted.some(Boolean) ? converted : null;
    } catch {
      kuroshiroPromise = null;
      romanizationCache.delete(key);
      return null;
    }
  })();

  if (romanizationCache.size >= ROMANIZATION_CACHE_LIMIT) {
    const oldest = romanizationCache.keys().next().value;
    if (oldest !== undefined) romanizationCache.delete(oldest);
  }
  romanizationCache.set(key, promise);
  return promise;
}

interface UseLyricsRomanizationOptions {
  enabled: boolean;
  syncedLines: LrcLine[] | null;
  wordLines: WordLyricsLine[] | null;
  plainLyrics: string | null;
  pronunciationLines: LrcLine[] | null;
  pronunciationPlainLyrics: string | null;
}

export function useLyricsRomanization({
  enabled,
  syncedLines,
  wordLines,
  plainLyrics,
  pronunciationLines,
  pronunciationPlainLyrics,
}: UseLyricsRomanizationOptions): string[] | null {
  const original = useMemo(
    () => originalLyricsLines(syncedLines, wordLines, plainLyrics),
    [plainLyrics, syncedLines, wordLines],
  );
  const originalLines = original.texts;
  const key = originalLines.join('\u0000');
  const serverPronunciation = useMemo(
    () => alignLyricsLayer(original, pronunciationLines, pronunciationPlainLyrics),
    [original, pronunciationLines, pronunciationPlainLyrics],
  );
  const [generated, setGenerated] = useState<{ key: string; lines: string[] | null } | null>(null);

  useEffect(() => {
    if (!enabled || serverPronunciation || originalLines.length === 0) return;
    let cancelled = false;
    void romanizeJapaneseLines(originalLines).then(lines => {
      if (!cancelled) setGenerated({ key, lines });
    });
    return () => { cancelled = true; };
  }, [enabled, key, originalLines, serverPronunciation]);

  if (!enabled || originalLines.length === 0) return null;
  if (serverPronunciation) return serverPronunciation;
  return generated?.key === key ? generated.lines : null;
}
