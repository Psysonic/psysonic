import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeLanguageCode, SUPPORTED_LANGUAGE_CODES } from '@/lib/i18n';

describe('normalizeLanguageCode', () => {
  it('accepts codes we ship', () => {
    expect(normalizeLanguageCode('en')).toBe('en');
    expect(normalizeLanguageCode('de')).toBe('de');
    expect(normalizeLanguageCode(' uk ')).toBe('uk');
  });

  it('unwraps the JSON quoting an older backup import added', () => {
    expect(normalizeLanguageCode('"en"')).toBe('en');
    expect(normalizeLanguageCode('"de"')).toBe('de');
    // A value that survived two round-trips.
    expect(normalizeLanguageCode('"\\"en\\""')).toBe('en');
  });

  it('rejects anything we cannot render', () => {
    expect(normalizeLanguageCode('xx')).toBeNull();
    expect(normalizeLanguageCode('en-US')).toBeNull();
    expect(normalizeLanguageCode('')).toBeNull();
    expect(normalizeLanguageCode(null)).toBeNull();
    expect(normalizeLanguageCode('"xx"')).toBeNull();
  });

  it('covers every language the app ships', () => {
    for (const code of SUPPORTED_LANGUAGE_CODES) {
      expect(normalizeLanguageCode(code)).toBe(code);
    }
  });
});

describe('startup language', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('repairs a quoted stored value in place', async () => {
    localStorage.setItem('psysonic_language', '"de"');
    const { default: i18n } = await import('@/lib/i18n');
    expect(i18n.language).toBe('de');
    expect(localStorage.getItem('psysonic_language')).toBe('de');
  });

  it('replaces a stored value it cannot use and starts in English', async () => {
    localStorage.setItem('psysonic_language', 'not a language');
    const { default: i18n } = await import('@/lib/i18n');
    expect(i18n.language).toBe('en');
    expect(localStorage.getItem('psysonic_language')).toBe('en');
  });

  it('leaves a good stored value alone', async () => {
    localStorage.setItem('psysonic_language', 'fr');
    const { default: i18n } = await import('@/lib/i18n');
    expect(i18n.language).toBe('fr');
    expect(localStorage.getItem('psysonic_language')).toBe('fr');
  });
});
