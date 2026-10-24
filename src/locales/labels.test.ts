import { describe, expect, it } from 'vitest';

import i18n, { SUPPORTED_LANGUAGE_CODES } from '@/lib/i18n';

describe('label browsing translations', () => {
  it('provides label page and migration text in every non-English language', () => {
    const keys = [
      'sidebar.labels',
      'labels.title',
      'labels.loading',
      'labels.empty',
      'labels.albumsEmpty',
      'labels.back',
      'migration.recordLabelTagsTitle',
      'migration.recordLabelTagsBody',
      'migration.recordLabelTagsFailed',
    ];
    for (const lng of SUPPORTED_LANGUAGE_CODES.filter(code => code !== 'en')) {
      for (const key of keys) {
        expect(i18n.exists(key, { lng, fallbackLng: false }), `${lng}: ${key}`).toBe(true);
      }
      expect(i18n.t('labels.albumCount', { lng, count: 5 }), lng).toContain('5');
    }
  });
});
