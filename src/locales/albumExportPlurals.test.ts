import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';

const COUNTS = [1, 2, 5, 13, 21, 31];
/** A stem in each language's own wording, so an English fallback cannot pass. */
const OWN_WORDING: Record<string, { albums: RegExp; images: RegExp }> = {
  de: { albums: /Album|Alben/, images: /Bild/ },
  es: { albums: /álbum/, images: /imagen|imágenes/ },
  ru: { albums: /альбом/, images: /изображени/ },
  uk: { albums: /альбом/, images: /зображен/ },
  pl: { albums: /album/, images: /obraz/ },
  ro: { albums: /album/, images: /imagin/ },
  fr: { albums: /album/, images: /image/ },
};

describe('album export plurals', () => {
  it.each(Object.entries(OWN_WORDING))('%s resolves every count without falling back to English', (lng, w) => {
    for (const count of COUNTS) {
      expect(i18n.t('albumExport.albumCount', { count, lng })).toMatch(w.albums);
      expect(i18n.t('albumExport.previewImages', { count, split: '16 + 15', lng })).toMatch(w.images);
    }
  });

  it('uses Spanish singular and plural', () => {
    expect(i18n.t('albumExport.albumCount', { count: 1, lng: 'es' })).toBe('1 álbum');
    expect(i18n.t('albumExport.albumCount', { count: 31, lng: 'es' })).toBe('31 álbumes');
    expect(i18n.t('albumExport.part', { page: 1, pages: 2, lng: 'es' })).toBe('Parte 1 / 2');
    expect(i18n.t('albumExport.range', { from: 17, to: 31, total: 31, lng: 'es' })).toBe('Álbumes 17–31 de 31');
  });

  it('uses distinct Russian one, few and many forms', () => {
    expect(i18n.t('albumExport.albumCount', { count: 1, lng: 'ru' })).toBe('1 альбом');
    expect(i18n.t('albumExport.albumCount', { count: 3, lng: 'ru' })).toBe('3 альбома');
    expect(i18n.t('albumExport.albumCount', { count: 31, lng: 'ru' })).toBe('31 альбом');
    expect(i18n.t('albumExport.albumCount', { count: 13, lng: 'ru' })).toBe('13 альбомов');
  });
});
