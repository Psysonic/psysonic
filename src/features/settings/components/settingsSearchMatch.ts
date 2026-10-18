// Text matching for the settings search. Every query word has to match
// somewhere: as a whole word, a word start, a substring, or a word with one
// typo (two for words of eight letters or more). The caller only allows typos
// for a query word that matches nowhere exactly, so "tray" does not drift to
// "track".

export interface PreparedText {
  norm: string;
  words: string[];
}

const WORD_SPLIT = /[^\p{L}\p{N}]+/u;
// Edit-distance matching only makes sense for alphabetic scripts; CJK queries
// rely on the substring step instead.
const FUZZY_SCRIPT = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{N}]+$/u;

/** Lowercase, without diacritics, HTML tags or `{{placeholders}}`. */
export function normalizeSearchText(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function prepareText(text: string): PreparedText {
  const norm = normalizeSearchText(text);
  return { norm, words: norm.split(WORD_SPLIT).filter(Boolean) };
}

export function queryTokens(query: string): string[] {
  return normalizeSearchText(query).split(WORD_SPLIT).filter(Boolean);
}

/** Optimal-string-alignment distance; returns `max + 1` as soon as it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prevPrev: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prevPrev[j - 2] + 1);
      }
      cur.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** Whole word, word start or substring (a plural "s" may be missing); 0 when only a typo would match. */
export function exactTokenScore(token: string, text: PreparedText): number {
  const stem = token.length >= 4 && token.endsWith('s') ? token.slice(0, -1) : null;
  let best = 0;
  for (const word of text.words) {
    if (word === token) return 1;
    if (stem && word === stem) best = Math.max(best, 0.95);
    if (word.startsWith(token)) best = Math.max(best, token.length === 1 ? 0.6 : 0.9);
    else if (stem && word.startsWith(stem)) best = Math.max(best, 0.85);
  }
  if (best > 0) return best;
  if (token.length >= 2 && text.norm.includes(token)) return 0.75;
  return 0;
}

/** The same word with one typo (two for words of eight letters or more). */
export function fuzzyTokenScore(token: string, text: PreparedText): number {
  if (token.length < 4 || !FUZZY_SCRIPT.test(token)) return 0;
  const maxEdits = token.length >= 8 ? 2 : 1;
  let best = 0;
  for (const word of text.words) {
    if (word.length < 3) continue;
    const whole = editDistance(token, word, maxEdits);
    if (whole <= maxEdits) best = Math.max(best, whole === 1 ? 0.7 : 0.55);
    if (token.length >= 5 && word.length > token.length) {
      // A typo in the start of a longer word: "navidorme" → "navidrome".
      const start = editDistance(token, word.slice(0, token.length), maxEdits);
      if (start <= maxEdits) best = Math.max(best, start === 1 ? 0.6 : 0.45);
    }
  }
  return best;
}

/** How well one query word matches a text: 0 = not at all, 1 = a whole word. */
export function tokenScore(token: string, text: PreparedText, allowFuzzy = true): number {
  const exact = exactTokenScore(token, text);
  if (exact > 0 || !allowFuzzy) return exact;
  return fuzzyTokenScore(token, text);
}
