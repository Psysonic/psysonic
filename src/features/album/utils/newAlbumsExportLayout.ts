/**
 * Pure layout rules for the new-albums PNG export: palettes, type scale,
 * page split, text wrapping and the "year · genre" line. Nothing here touches
 * the DOM, so the rules are unit-tested without a canvas.
 */

export type NewAlbumsExportScheme = 'dark' | 'light';

export interface NewAlbumsExportPalette {
  background: string;
  text: string;
  accent: string;
  meta: string;
  rule: string;
  placeholder: string;
  placeholderMark: string;
}

/** Dark keeps the export's original Catppuccin Macchiato colors; light is Catppuccin Latte. */
export const NEW_ALBUMS_EXPORT_PALETTES: Record<NewAlbumsExportScheme, NewAlbumsExportPalette> = {
  dark: {
    background: '#24273a',
    text: '#cad3f5',
    accent: '#c6a0f6',
    meta: '#a5adcb',
    rule: '#363a4f',
    placeholder: '#363a4f',
    placeholderMark: '#6e738d',
  },
  light: {
    background: '#eff1f5',
    text: '#4c4f69',
    accent: '#8839ef',
    meta: '#6c6f85',
    rule: '#ccd0da',
    placeholder: '#dce0e8',
    placeholderMark: '#9ca0b0',
  },
};

/** Fixed family so the image looks the same on every OS and app font choice. */
export const NEW_ALBUMS_EXPORT_FONT = '"Inter Variable", system-ui, sans-serif';

export const NEW_ALBUMS_EXPORT_GEOMETRY = {
  width: 1080,
  padX: 40,
  columnGap: 36,
  cover: 108,
  coverRadius: 6,
  textGap: 16,
  rowPad: 12,
  maxPerPage: 16,
} as const;

export interface NewAlbumsExportTextStyle {
  size: number;
  weight: number;
  lineHeight: number;
  /** Baseline offset from the top of the line box. */
  baseline: number;
}

export const NEW_ALBUMS_EXPORT_TYPE: Record<'heading' | 'subline' | 'artist' | 'title' | 'meta' | 'footer', NewAlbumsExportTextStyle> = {
  heading: { size: 64, weight: 700, lineHeight: 72, baseline: 54 },
  subline: { size: 22, weight: 400, lineHeight: 30, baseline: 22 },
  artist: { size: 23, weight: 600, lineHeight: 28, baseline: 21 },
  title: { size: 29, weight: 700, lineHeight: 34, baseline: 27 },
  meta: { size: 22, weight: 400, lineHeight: 30, baseline: 23 },
  footer: { size: 20, weight: 400, lineHeight: 28, baseline: 20 },
};

export function exportFont(style: Pick<NewAlbumsExportTextStyle, 'size' | 'weight'>, size = style.size): string {
  return `${style.weight} ${size}px ${NEW_ALBUMS_EXPORT_FONT}`;
}

export const NEW_ALBUMS_EXPORT_COLUMN_WIDTH =
  (NEW_ALBUMS_EXPORT_GEOMETRY.width - 2 * NEW_ALBUMS_EXPORT_GEOMETRY.padX - NEW_ALBUMS_EXPORT_GEOMETRY.columnGap) / 2;

export const NEW_ALBUMS_EXPORT_TEXT_WIDTH =
  NEW_ALBUMS_EXPORT_COLUMN_WIDTH - NEW_ALBUMS_EXPORT_GEOMETRY.cover - NEW_ALBUMS_EXPORT_GEOMETRY.textGap;

/**
 * Splits `items` into the fewest pages of at most `maxPerPage`, spread evenly:
 * 31 → 16 + 15, 17 → 9 + 8. Order is preserved and every item lands once.
 */
export function paginateEvenly<T>(items: readonly T[], maxPerPage: number = NEW_ALBUMS_EXPORT_GEOMETRY.maxPerPage): T[][] {
  if (items.length === 0) return [];
  const pageCount = Math.ceil(items.length / maxPerPage);
  const base = Math.floor(items.length / pageCount);
  const extra = items.length % pageCount;
  const pages: T[][] = [];
  let start = 0;
  for (let p = 0; p < pageCount; p++) {
    const size = base + (p < extra ? 1 : 0);
    pages.push(items.slice(start, start + size));
    start += size;
  }
  return pages;
}

/** Page sizes as shown in the dialog preview ("16 + 15"). */
export function pageSizes(total: number, maxPerPage: number = NEW_ALBUMS_EXPORT_GEOMETRY.maxPerPage): number[] {
  return paginateEvenly(Array.from({ length: total }, (_, i) => i), maxPerPage).map(p => p.length);
}

/** Year and genre joined by a middle dot; a missing part leaves no stray separator. */
export function albumMetaLine(year?: number | null, genre?: string | null): string {
  const parts = [year ? String(year) : '', genre?.trim() ?? ''].filter(Boolean);
  return parts.join('  ·  ');
}

type Measure = (text: string) => number;

const NO_HYPHEN_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;

// The project's TS lib predates `Intl.Segmenter`; every engine the app ships on has it.
type GraphemeSegmenter = { segment(input: string): Iterable<{ segment: string }> };
const Segmenter = (Intl as unknown as {
  Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => GraphemeSegmenter;
}).Segmenter;

/** Splits into user-perceived characters, so accents and emoji never break apart. */
function graphemes(text: string): string[] {
  if (!Segmenter) return Array.from(text);
  return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), s => s.segment);
}

/** Breaks one word that is wider than the line into pieces; returns the full pieces and the remainder. */
function breakWord(word: string, maxWidth: number, measure: Measure): { full: string[]; rest: string } {
  const full: string[] = [];
  let piece = '';
  for (const ch of graphemes(word)) {
    const hyphen = piece && !NO_HYPHEN_SCRIPT.test(ch) && !NO_HYPHEN_SCRIPT.test(piece.slice(-1)) ? '-' : '';
    if (piece && measure(piece + ch + hyphen) > maxWidth) {
      full.push(piece + hyphen);
      piece = ch;
    } else {
      piece += ch;
    }
  }
  return { full, rest: piece };
}

/**
 * Greedy word wrap with no line limit — the export never truncates. A word
 * wider than the line is split by grapheme (hyphenated in alphabetic scripts).
 */
export function wrapText(text: string, maxWidth: number, measure: Measure): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (measure(word) <= maxWidth) {
      current = word;
    } else {
      const { full, rest } = breakWord(word, maxWidth, measure);
      lines.push(...full);
      current = rest;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}
