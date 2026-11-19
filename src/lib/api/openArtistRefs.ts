import type { SubsonicOpenArtistRef } from '@/lib/api/subsonicTypes';

function trimRef(ref: SubsonicOpenArtistRef): SubsonicOpenArtistRef {
  const id = ref.id?.trim() || undefined;
  const name = ref.name?.trim() || undefined;
  if (id === ref.id && name === ref.name) return ref;
  return { ...ref, id, name };
}

/** Subsonic JSON may return one ref object instead of a one-element array. */
export function coerceOpenArtistRefs(
  refs: SubsonicOpenArtistRef[] | SubsonicOpenArtistRef | undefined | null,
): SubsonicOpenArtistRef[] {
  if (refs == null) return [];
  if (Array.isArray(refs)) {
    const normalized = refs.map(trimRef);
    return normalized.every((ref, index) => ref === refs[index]) ? refs : normalized;
  }
  if (typeof refs === 'object') return [trimRef(refs)];
  return [];
}

/**
 * Separators Navidrome uses to split a *single-valued* ARTIST / ALBUMARTIST tag into
 * individual artists (Navidrome docs, Usage → Library → Tagging): `" / "`,
 * `" feat. "`, `" feat "`, `" ft. "`, `" ft "` and `"; "`, matched case-insensitively.
 *
 * `" • "` (space • space) is also split: it is the default `Scanner.ArtistJoiner`
 * Navidrome uses to build the display name from only-plural ARTISTS tags
 * (`Alice • Bob`), so a legacy flat credit that carries that joined string must
 * still resolve to individual artists.
 *
 * Two deliberate details from that spec:
 * - The slash form requires surrounding spaces. That is what keeps "AC/DC" intact,
 *   so it must not be relaxed to a bare `/`.
 * - A comma is NOT a separator. "Daniel Hope, Konzerthaus Kammerorchester Berlin"
 *   stays one credit, exactly as the server would treat it.
 *
 * Longer forms come first so `" feat. "` wins over `" feat "` at the same position.
 * No `g` flag: `String.split` matches every occurrence anyway, and a shared global
 * regex would carry `lastIndex` state between calls.
 */
const DISPLAY_ARTIST_SEPARATORS = / \/ | feat\. | feat | ft\. | ft |; | • /i;

/**
 * Individual artist names from a joined display credit, or `[]` when there is
 * nothing to show. A name with no separator yields a single entry, so callers can
 * use this unconditionally.
 */
export function splitDisplayArtistName(display: string | null | undefined): string[] {
  const value = display?.trim();
  if (!value) return [];
  return value
    .split(DISPLAY_ARTIST_SEPARATORS)
    .map(part => part.trim())
    .filter(Boolean);
}

/**
 * Fallback credits for servers/rows that carry only the joined display string —
 * OpenSubsonic `artists` / `albumArtists` are always preferred when present, since
 * those come with an id per artist and need no guessing.
 *
 * Only the first name keeps `id`: the server's `artistId` identifies the primary
 * artist the credit is filed under, and the split-out guests have no id here. They
 * render as plain text rather than a link that would point at the wrong artist.
 */
export function displayArtistRefs(
  display: string | null | undefined,
  id?: string | null,
): SubsonicOpenArtistRef[] {
  const names = splitDisplayArtistName(display);
  if (names.length === 0) return [];
  const primaryId = id?.trim();
  return names.map((name, index) => (
    index === 0 && primaryId ? { id: primaryId, name } : { name }
  ));
}

/**
 * Extract trimmed artist names from OpenSubsonic `artists` when the first
 * entry carries a usable name. Returns `undefined` when absent or when slot 0
 * has no name, so a later guest artist is never promoted into slot 0.
 */
export function structuredArtistNames(
  refs: SubsonicOpenArtistRef[] | SubsonicOpenArtistRef | undefined | null,
): string[] | undefined {
  const coerced = coerceOpenArtistRefs(refs);
  if (!coerced[0]?.name) return undefined;
  const names = coerced
    .map(ref => ref.name)
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names : undefined;
}

/**
 * Resolve the primary (first) artist name for a track credit.
 * Prefers slot 0 of structured `artists` when it has a non-empty name,
 * otherwise falls back to splitting the joined display string.
 */
export function firstArtistName(
  artist: string,
  artists?: string[] | SubsonicOpenArtistRef[] | SubsonicOpenArtistRef | null,
): string {
  if (Array.isArray(artists)) {
    const firstEntry = artists[0];
    if (typeof firstEntry === 'string') {
      const trimmed = firstEntry.trim();
      if (trimmed) return trimmed;
    } else if (firstEntry) {
      const name = coerceOpenArtistRefs(firstEntry)[0]?.name;
      if (name) return name;
    }
  } else if (artists) {
    const name = coerceOpenArtistRefs(artists)[0]?.name;
    if (name) return name;
  }
  return splitDisplayArtistName(artist)[0] ?? artist.trim();
}
