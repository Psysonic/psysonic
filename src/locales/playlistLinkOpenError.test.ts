import { describe, expect, it } from 'vitest';
import i18n, { SUPPORTED_LANGUAGE_CODES } from '@/lib/i18n';

describe('playlist link error translations', () => {
  it('has a nonempty translation in every supported language', () => {
    const english = i18n.getResource('en', 'translation', 'playlists.linkOpenError');
    for (const language of SUPPORTED_LANGUAGE_CODES) {
      const message = i18n.getResource(language, 'translation', 'playlists.linkOpenError');
      expect(message, language).toEqual(expect.any(String));
      expect(message.trim(), language).not.toBe('');
      if (language !== 'en') expect(message, language).not.toBe(english);
    }
  });
});
