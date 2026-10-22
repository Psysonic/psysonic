import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';

// Offline Library header: "{{n}} albums". The call passes the count as both
// `n` (the placeholder) and `count` (plural selection).
const albums = (count: number, lng: string) =>
  i18n.t('connection.offlineAlbumCount', { n: count, count, lng });

const EXPECTED: Record<string, Record<number, string>> = {
  en: { 1: '1 album', 3: '3 albums' },
  de: { 1: '1 Album', 3: '3 Alben' },
  bg: { 1: '1 албум', 3: '3 албума' },
  es: { 1: '1 álbum', 3: '3 álbumes', 1_000_000: '1000000 álbumes' },
  fr: { 1: '1 album', 3: '3 albums', 1_000_000: '1000000 albums' },
  hu: { 1: '1 album', 3: '3 album' },
  it: { 1: '1 album', 3: '3 album', 1_000_000: '1000000 album' },
  ja: { 1: '1 枚のアルバム', 3: '3 枚のアルバム' },
  nb: { 1: '1 album', 3: '3 album' },
  nl: { 1: '1 album', 3: '3 albums' },
  pl: { 1: '1 album', 3: '3 albumy', 5: '5 albumów', 22: '22 albumy' },
  ro: { 1: '1 album', 3: '3 albume', 20: '20 albume' },
  ru: { 1: '1 альбом', 3: '3 альбома', 5: '5 альбомов' },
  uk: { 1: '1 альбом', 3: '3 альбоми', 5: '5 альбомів' },
  zh: { 1: '1 张专辑', 3: '3 张专辑' },
  el: { 1: '1 άλμπουμ', 3: '3 άλμπουμ' },
};

describe('offline library album count', () => {
  it.each(Object.entries(EXPECTED))('%s picks the right plural form', (lng, cases) => {
    for (const [count, text] of Object.entries(cases)) {
      expect(albums(Number(count), lng)).toBe(text);
    }
  });

  it('covers every shipped locale', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.keys(i18n.options.resources ?? {}).sort());
  });

  it('leaves no key on the pre-v21 `_plural` suffix, which i18next no longer reads', () => {
    const legacy: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        const next = path ? `${path}.${key}` : key;
        if (key.endsWith('_plural')) legacy.push(next);
        walk(value, next);
      }
    };
    walk(i18n.options.resources, '');
    expect(legacy).toEqual([]);
  });
});
