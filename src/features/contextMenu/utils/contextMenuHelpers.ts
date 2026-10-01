import type { SubsonicPlaylist } from '@/lib/api/subsonicTypes';
import { classifyPlaylistSmartness } from '@/lib/format/playlistClassification';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';

/** How many recently used targets the add-to-playlist submenus show on top. */
export const RECENT_PLAYLIST_TARGETS = 3;
/** Below this many targets the recent section would only repeat the whole list. */
export const RECENT_PLAYLIST_TARGETS_MIN_LIST = 6;

/**
 * Add-to-playlist targets as the submenus show them: every target in
 * alphabetical order, plus — once the list is long enough to need it — the few
 * used most recently, newest first. Recent ones stay in the full list too, so
 * looking a playlist up by name always works.
 */
export function splitPlaylistTargets(
  targets: readonly SubsonicPlaylist[],
  recentIds: readonly string[],
  serverId: string | undefined,
): { recent: SubsonicPlaylist[]; all: SubsonicPlaylist[] } {
  const all = [...targets].sort((a, b) => a.name.localeCompare(b.name));
  if (!serverId || all.length < RECENT_PLAYLIST_TARGETS_MIN_LIST) return { recent: [], all };
  const byKey = new Map(all.map(playlist => [ownedEntityKey({ id: playlist.id, serverId }), playlist]));
  const recent: SubsonicPlaylist[] = [];
  for (const key of recentIds) {
    const playlist = byKey.get(key);
    if (playlist) recent.push(playlist);
    if (recent.length === RECENT_PLAYLIST_TARGETS) break;
  }
  return { recent, all };
}

export function manualPlaylistTargetsForServer(
  playlists: readonly SubsonicPlaylist[],
  serverId: string | undefined,
): SubsonicPlaylist[] {
  if (!serverId) return [];
  return playlists.filter(playlist => (
    playlist.serverId === serverId
    && classifyPlaylistSmartness(playlist) === 'manual'
  ));
}

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .substring(0, 200) || 'download';
}

/** Fisher-Yates in-place shuffle — returns a new array, does not mutate the input. */
export function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
