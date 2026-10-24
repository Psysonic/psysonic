import { describe, expect, it } from 'vitest';

import i18n, { SUPPORTED_LANGUAGE_CODES } from '@/lib/i18n';

describe('mood browsing translations', () => {
  it('provides localized browse and migration text in every non-English language', () => {
    const keys = [
      'sidebar.moods',
      'moods.title',
      'moods.loading',
      'moods.empty',
      'moods.albumsEmpty',
      'moods.back',
      'migration.fileMoodTagsTitle',
      'migration.fileMoodTagsBody',
      'migration.fileMoodTagsFailed',
    ];

    for (const lng of SUPPORTED_LANGUAGE_CODES.filter(code => code !== 'en')) {
      for (const key of keys) {
        expect(i18n.t(key, { lng }), `${lng}: ${key}`).not.toBe(
          i18n.t(key, { lng: 'en' }),
        );
      }
      for (const key of [
        'moods.albumsTab',
        'moods.tracksTab',
        'moods.viewTabsLabel',
        'moods.tracksEmpty',
      ]) {
        expect(i18n.getResource(lng, 'translation', key), `${lng}: ${key}`).toBeTruthy();
      }

      for (const count of [1, 2, 5]) {
        expect(i18n.getResource(lng, 'translation', 'moods.albumCount_one'), lng)
          .toBeTruthy();
        expect(i18n.t('moods.albumCount', { lng, count }), `${lng}: ${count} albums`)
          .toContain(String(count));
      }
    }
  });

  it('uses the right singular and Slavic plural forms for mood counts', () => {
    expect(i18n.t('moods.moodCount', { lng: 'en', count: 1 })).toBe('Mood');
    expect(i18n.t('moods.moodCount', { lng: 'en', count: 2 })).toBe('Moods');
    expect(i18n.t('moods.moodCount', { lng: 'ru', count: 1 })).toBe('настроение');
    expect(i18n.t('moods.moodCount', { lng: 'ru', count: 2 })).toBe('настроения');
    expect(i18n.t('moods.moodCount', { lng: 'ru', count: 5 })).toBe('настроений');
    expect(i18n.t('moods.moodCount', { lng: 'uk', count: 1 })).toBe('настрій');
    expect(i18n.t('moods.moodCount', { lng: 'uk', count: 2 })).toBe('настрої');
    expect(i18n.t('moods.moodCount', { lng: 'uk', count: 5 })).toBe('настроїв');
    expect(i18n.t('moods.moodCount', { lng: 'pl', count: 1 })).toBe('nastrój');
    expect(i18n.t('moods.moodCount', { lng: 'pl', count: 2 })).toBe('nastroje');
    expect(i18n.t('moods.moodCount', { lng: 'pl', count: 5 })).toBe('nastrojów');
  });
});
