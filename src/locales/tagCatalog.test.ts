import { describe, expect, it } from 'vitest';
import i18n, { SUPPORTED_LANGUAGE_CODES } from '@/lib/i18n';

describe('catalog discovery translations', () => {
  it('provides every new key in every shipped locale without English fallback', () => {
    for (const lng of SUPPORTED_LANGUAGE_CODES) {
      for (const catalog of ['genres', 'moods']) {
        for (const key of ['searchPlaceholder', 'searchLabel', 'clearSearch', 'filteredCount', 'noSearchResults', 'sortLabel', 'sortPopularity', 'sortAlphabetical']) {
          expect(i18n.exists(`${catalog}.${key}`, { lng, fallbackLng: false }), `${lng}: ${catalog}.${key}`).toBe(true);
        }
        const count = i18n.t(`${catalog}.filteredCount`, { lng, visible: 2, total: 10 });
        expect(count).toContain('2');
        expect(count).toContain('10');
      }
    }
  });
});
