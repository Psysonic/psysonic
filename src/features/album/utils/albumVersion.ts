import type { SubsonicAlbum, SubsonicSong } from '@/lib/api/subsonicTypes';

/** Same bracket pairs as `album_name_without_appended_version` in the Rust identity keys. */
const VERSION_WRAPPERS: readonly (readonly [string, string])[] = [
  ['(', ')'], ['[', ']'], ['{', '}'], ['<', '>'],
  ['（', '）'], ['［', '］'], ['｛', '｝'], ['＜', '＞'],
  ['【', '】'], ['「', '」'], ['『', '』'],
];

function unwrapVersion(version: string): string {
  for (const [open, close] of VERSION_WRAPPERS) {
    if (version.length >= 2 && version.startsWith(open) && version.endsWith(close)) {
      return version.slice(open.length, version.length - close.length).trim();
    }
  }
  return version;
}

/** True when `name` ends with the version appended in brackets after a space. */
function nameEndsWithVersion(name: string, version: string): boolean {
  const bare = unwrapVersion(version).toLowerCase();
  if (!bare) return false;
  const lowered = name.trim().toLowerCase();
  return VERSION_WRAPPERS.some(([open, close]) => {
    const suffix = `${open}${bare}${close}`;
    return lowered.endsWith(suffix) && /\s$/.test(lowered.slice(0, -suffix.length));
  });
}

/**
 * The edition label to show under the album title ("Deluxe Edition"), or `null`.
 *
 * The album's own `version` wins. Without it the label comes from the tracks, by
 * the same agreement rule as the album comment: every track that carries one must
 * carry the same text. It is `null` when the title already ends with it, because
 * Navidrome's Subsonic API appends the version to the album name by default.
 */
export function deriveAlbumVersion(
  album: Pick<SubsonicAlbum, 'name' | 'version'>,
  songs: readonly SubsonicSong[],
): string | null {
  let version = typeof album.version === 'string' ? album.version.trim() : '';
  if (!version) {
    for (const song of songs) {
      const value = typeof song.albumVersion === 'string' ? song.albumVersion.trim() : '';
      if (!value) continue;
      if (!version) version = value;
      else if (version !== value) return null;
    }
  }
  if (!version) return null;
  if (nameEndsWithVersion(album.name, version)) return null;
  return version;
}
