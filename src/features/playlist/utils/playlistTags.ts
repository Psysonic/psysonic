/**
 * Playlist tags — local labels on playlists, used as filter chips on the
 * Playlists page. Like folders, the Subsonic API has nowhere to keep them, so
 * they live only in Psysonic (`playlistTagStore`). Unlike folders, a playlist
 * can carry several tags, and the vocabulary is shared across servers: a tag
 * is identified by its name, compared case-insensitively.
 */

/** serverId → playlistId → tag names in their display spelling. */
export type PlaylistTagsByServer = Record<string, Record<string, string[]>>;

export interface PlaylistTagTarget {
  serverId: string;
  playlistId: string;
}

/** Trim and collapse inner whitespace; an empty result means "no tag". */
export function normalizePlaylistTagName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Identity of a tag: "Chill" and "chill " are the same tag. */
export function playlistTagKey(name: string): string {
  return normalizePlaylistTagName(name).toLowerCase();
}

const EMPTY_TAGS: readonly string[] = [];

export function playlistTagsFor(
  byServer: PlaylistTagsByServer,
  serverId: string | null | undefined,
  playlistId: string,
): readonly string[] {
  if (!serverId) return EMPTY_TAGS;
  return byServer[serverId]?.[playlistId] ?? EMPTY_TAGS;
}

function sortedUnique(names: Iterable<string>): string[] {
  const byKey = new Map<string, string>();
  for (const name of names) {
    const key = playlistTagKey(name);
    if (key && !byKey.has(key)) byKey.set(key, name);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** Every tag known on this device, across all servers, in display order. */
export function allPlaylistTags(byServer: PlaylistTagsByServer): string[] {
  return sortedUnique(
    Object.values(byServer).flatMap(bucket => Object.values(bucket).flat()),
  );
}

/** Tags carried by at least one of `playlists`, in display order. */
export function collectPlaylistTags(
  byServer: PlaylistTagsByServer,
  playlists: readonly { id: string; serverId?: string }[],
): string[] {
  return sortedUnique(playlists.flatMap(pl => playlistTagsFor(byServer, pl.serverId, pl.id)));
}

/** Keep the playlists that carry every tag in `activeKeys` (AND). */
export function filterPlaylistsByTags<T extends { id: string; serverId?: string }>(
  playlists: T[],
  byServer: PlaylistTagsByServer,
  activeKeys: readonly string[],
): T[] {
  if (activeKeys.length === 0) return playlists;
  return playlists.filter(pl => {
    const keys = new Set(playlistTagsFor(byServer, pl.serverId, pl.id).map(playlistTagKey));
    return activeKeys.every(key => keys.has(key));
  });
}
