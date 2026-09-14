import { describe, expect, it } from 'vitest';
import { usableLocale } from '@/lib/format/localeTag';

describe('usableLocale', () => {
  it('passes through tags Intl accepts', () => {
    expect(usableLocale('en')).toBe('en');
    expect(usableLocale('de')).toBe('de');
    expect(usableLocale('pt-BR')).toBe('pt-BR');
  });

  it('falls back to the engine default for unusable tags', () => {
    // The shape an older settings-backup import produced: JSON quotes that
    // became part of the value.
    expect(usableLocale('"en"')).toBeUndefined();
    expect(usableLocale('en ')).toBeUndefined();
    expect(usableLocale('not a tag')).toBeUndefined();
    expect(usableLocale('')).toBeUndefined();
    expect(usableLocale(null)).toBeUndefined();
    expect(usableLocale(undefined)).toBeUndefined();
  });

  it('returns the same answer when a tag is asked for twice', () => {
    expect(usableLocale('"de"')).toBeUndefined();
    expect(usableLocale('"de"')).toBeUndefined();
    expect(usableLocale('de')).toBe('de');
    expect(usableLocale('de')).toBe('de');
  });
});
