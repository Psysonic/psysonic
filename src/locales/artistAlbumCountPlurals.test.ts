import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';

/**
 * `artists.albumCount` labels an artist's albums on the Artists page and in
 * Device Sync. Polish and Romanian resolve `few` (and Polish `many`) for
 * counts like 3 or 5; without those forms i18next falls back to the English
 * "3 Albums". Exact strings, because the English fallback shares the stem.
 */
const key = 'artists.albumCount';

describe('artist album count plurals', () => {
  it('uses the Polish one, few and many forms', () => {
    expect(i18n.t(key, { count: 1, lng: 'pl' })).toBe('1 album');
    expect(i18n.t(key, { count: 3, lng: 'pl' })).toBe('3 albumy');
    expect(i18n.t(key, { count: 5, lng: 'pl' })).toBe('5 albumów');
    expect(i18n.t(key, { count: 22, lng: 'pl' })).toBe('22 albumy');
  });

  it('uses the Romanian one and few forms', () => {
    expect(i18n.t(key, { count: 1, lng: 'ro' })).toBe('1 Album');
    expect(i18n.t(key, { count: 3, lng: 'ro' })).toBe('3 Albume');
    expect(i18n.t(key, { count: 20, lng: 'ro' })).toBe('20 Albume');
  });

  it('keeps Russian distinct across its categories', () => {
    expect(i18n.t(key, { count: 1, lng: 'ru' })).toBe('1 альбом');
    expect(i18n.t(key, { count: 3, lng: 'ru' })).toBe('3 альбома');
    expect(i18n.t(key, { count: 5, lng: 'ru' })).toBe('5 альбомов');
  });
});
