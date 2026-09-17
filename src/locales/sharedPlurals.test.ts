import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';

const COUNTS = [1, 2, 5, 13, 21, 1_000_000];
const OWN_WORDING: Record<string, { links: RegExp; resources: RegExp }> = {
  ru: { links: /ссыл/, resources: /объект/ },
  uk: { links: /посилан/, resources: /об’єкт/ },
  pl: { links: /link/, resources: /element/ },
  ro: { links: /link/, resources: /element/ },
  es: { links: /enlace/, resources: /elemento/ },
  fr: { links: /lien/, resources: /élément/ },
  it: { links: /link/, resources: /element/ },
};

describe('shared link and resource plurals', () => {
  it.each(Object.entries(OWN_WORDING))(
    '%s resolves every CLDR category without falling back to English',
    (lng, wording) => {
      for (const count of COUNTS) {
        expect(i18n.t('shared.links', { count, lng })).toMatch(wording.links);
        expect(i18n.t('shared.resources', { count, lng })).toMatch(wording.resources);
      }
    },
  );

  it('uses distinct Russian one, few, and many forms', () => {
    expect(i18n.t('shared.links', { count: 1, lng: 'ru' })).toBe('1 ссылка');
    expect(i18n.t('shared.links', { count: 3, lng: 'ru' })).toBe('3 ссылки');
    expect(i18n.t('shared.links', { count: 13, lng: 'ru' })).toBe('13 ссылок');
    expect(i18n.t('shared.resources', { count: 1, lng: 'ru' })).toBe('1 объект');
    expect(i18n.t('shared.resources', { count: 3, lng: 'ru' })).toBe('3 объекта');
    expect(i18n.t('shared.resources', { count: 13, lng: 'ru' })).toBe('13 объектов');
  });
});
