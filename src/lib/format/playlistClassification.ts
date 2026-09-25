import type { SubsonicPlaylist } from '@/lib/api/subsonicTypes';

export const LEGACY_SMART_PLAYLIST_PREFIX = 'psy-smart-';

type ClassifiablePlaylist = Pick<SubsonicPlaylist, 'name'>
  & Pick<Partial<SubsonicPlaylist>, 'smart' | 'smartMetadataUnavailable' | 'readonly'>;

export type PlaylistSmartClassification = 'smart' | 'manual' | 'unknown';

export function hasLegacySmartPlaylistName(name: string): boolean {
  return name.toLowerCase().startsWith(LEGACY_SMART_PLAYLIST_PREFIX);
}

/**
 * Native metadata is authoritative; only failed Navidrome classification is unknown.
 *
 * When the native lookup fails, the Subsonic list still says enough: Navidrome marks every
 * smart playlist `readonly`, and every playlist the user does not own (`buildOSPlaylist`
 * in server/subsonic/playlists.go, checked for 0.62.0 and 0.63.2). A playlist it reports
 * as editable is therefore a manual one. Without this, a native lookup that fails for any
 * reason locked every playlist against adding, removing and reordering tracks.
 */
export function classifyPlaylistSmartness(playlist: ClassifiablePlaylist): PlaylistSmartClassification {
  if (playlist.smart === true) return 'smart';
  if (playlist.smart === false) return 'manual';
  if (hasLegacySmartPlaylistName(playlist.name)) return 'smart';
  if (!playlist.smartMetadataUnavailable) return 'manual';
  return playlist.readonly === false ? 'manual' : 'unknown';
}

export function isSmartPlaylist(playlist: ClassifiablePlaylist): boolean {
  return classifyPlaylistSmartness(playlist) === 'smart';
}

/** Keep legacy prefixed names visually unchanged while native smart names remain literal. */
export function playlistDisplayName(playlist: Pick<SubsonicPlaylist, 'name'>): string {
  return hasLegacySmartPlaylistName(playlist.name)
    ? playlist.name.slice(LEGACY_SMART_PLAYLIST_PREFIX.length)
    : playlist.name;
}

/** A Navidrome smart playlist has a root match-all or match-any expression. */
export function hasNavidromeSmartRules(rules: unknown): boolean {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return false;
  const record = rules as Record<string, unknown>;
  return Array.isArray(record.all) || Array.isArray(record.any);
}
