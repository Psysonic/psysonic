import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { deTranslation } from '@/locales/de';
import { enTranslation } from '@/locales/en';
import { frTranslation } from '@/locales/fr';
import { itTranslation } from '@/locales/it';
import { zhTranslation } from '@/locales/zh';
import { nbTranslation } from '@/locales/nb';
import { ruTranslation } from '@/locales/ru';
import { nlTranslation } from '@/locales/nl';
import { esTranslation } from '@/locales/es';
import { roTranslation } from '@/locales/ro';
import { jaTranslation } from '@/locales/ja';
import { huTranslation } from '@/locales/hu';
import { plTranslation } from '@/locales/pl';
import { bgTranslation } from '@/locales/bg';
import { ukTranslation } from '@/locales/uk';

const LANGUAGE_STORAGE_KEY = 'psysonic_language';

const resources = {
  en: { translation: enTranslation },
  de: { translation: deTranslation },
  es: { translation: esTranslation },
  fr: { translation: frTranslation },
  it: { translation: itTranslation },
  nl: { translation: nlTranslation },
  zh: { translation: zhTranslation },
  nb: { translation: nbTranslation },
  ru: { translation: ruTranslation },
  ro: { translation: roTranslation },
  ja: { translation: jaTranslation },
  hu: { translation: huTranslation },
  pl: { translation: plTranslation },
  bg: { translation: bgTranslation },
  uk: { translation: ukTranslation },
};

/** Every language we ship — the only values `i18n.language` may ever take. */
export const SUPPORTED_LANGUAGE_CODES = Object.keys(resources);

/**
 * Reduce an incoming language value to a code we actually ship, or `null`.
 *
 * This key holds a bare string rather than a serialized store, so a settings
 * backup used to round-trip it through `JSON.stringify` and write it back
 * quoted — `en` became `"en"`, quotes and all. That is not a valid BCP-47 tag,
 * so every `Intl` call built from it threw a `RangeError` and blanked the view
 * that made it. Peel that quoting off, then insist on a code from `resources`:
 * a language we cannot render is worse than falling back to English.
 */
export function normalizeLanguageCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  while (value.length > 1 && value.startsWith('"') && value.endsWith('"')) {
    let unwrapped: unknown;
    try {
      unwrapped = JSON.parse(value);
    } catch {
      break;
    }
    if (typeof unwrapped !== 'string') break;
    value = unwrapped.trim();
  }
  return SUPPORTED_LANGUAGE_CODES.includes(value) ? value : null;
}

/**
 * The startup language, repairing an unusable stored value in place so the
 * settings dropdown stops rendering it raw and the next `Intl` call is safe.
 */
function readSavedLanguage(): string {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  const code = normalizeLanguageCode(stored) ?? 'en';
  if (stored !== null && code !== stored) localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  return code;
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: readSavedLanguage(),
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

i18n.on('languageChanged', lng => {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
});

export default i18n;
