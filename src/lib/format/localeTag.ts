/**
 * A locale tag `Intl` will accept, or `undefined` to let the engine pick.
 *
 * The locale reaching our formatters comes from a persisted setting, and a
 * persisted value is not guaranteed to be a valid BCP-47 tag: settings backups
 * written before the raw-string round-trip fix stored the language JSON-quoted,
 * so `en` came back as `"en"` — quotes included. Every `Intl` constructor
 * rejects that with a `RangeError`, and since these helpers run inside render
 * paths, the throw took the whole view down with it.
 *
 * Falling back to the engine default formats a sensible string instead of
 * blanking a page. Results are memoized because the answer only depends on the
 * tag, and these helpers sit in list-rendering hot paths.
 */
const checkedTags = new Map<string, string | undefined>();

export function usableLocale(locale?: string | null): string | undefined {
  if (!locale) return undefined;
  if (checkedTags.has(locale)) return checkedTags.get(locale);
  let usable: string | undefined;
  try {
    // The exact validation every Intl constructor performs, without building one.
    Intl.getCanonicalLocales(locale);
    usable = locale;
  } catch {
    usable = undefined;
  }
  checkedTags.set(locale, usable);
  return usable;
}
