import { getAlbumForServer } from '@/lib/api/subsonicLibrary';
import { parseSubsonicEntityStarRating } from '@/lib/api/subsonicRatings';
import type { SubsonicAlbum, SubsonicDiscTitle, SubsonicSong } from '@/lib/api/subsonicTypes';
import { patchLibraryAlbumOnUse, patchLibraryTrackOnUse } from '@/lib/library/patchOnUse';

export type AlbumServerMetadataPatch = {
  userRating: number;
  starred?: string;
  discTitles?: SubsonicDiscTitle[];
};

function discTitlesEqual(
  local: SubsonicDiscTitle[] | undefined,
  server: SubsonicDiscTitle[],
): boolean {
  const localTitles = local ?? [];
  return localTitles.length === server.length && localTitles.every((entry, index) => (
    entry.disc === server[index]?.disc && entry.title === server[index]?.title
  ));
}

export function albumIsStarred(album: SubsonicAlbum): boolean {
  return !!album.starred;
}

export function albumUserRating(album: SubsonicAlbum): number {
  return parseSubsonicEntityStarRating(album) ?? 0;
}

/** Compare index/local album metadata with a fresh `#getAlbum` body. */
export function diffAlbumServerMetadata(
  local: SubsonicAlbum,
  server: SubsonicAlbum,
): AlbumServerMetadataPatch | null {
  const serverRating = albumUserRating(server);
  const localRating = albumUserRating(local);
  const serverStarred = albumIsStarred(server);
  const localStarred = albumIsStarred(local);
  const discTitlesChanged = server.discTitles !== undefined
    && !discTitlesEqual(local.discTitles, server.discTitles);
  if (
    serverRating === localRating
    && serverStarred === localStarred
    && !discTitlesChanged
  ) return null;
  const patch: AlbumServerMetadataPatch = { userRating: serverRating };
  if (serverStarred !== localStarred) {
    patch.starred = server.starred;
  }
  if (discTitlesChanged) {
    patch.discTitles = server.discTitles;
  }
  return patch;
}

export function applyAlbumServerMetadataPatch(
  album: SubsonicAlbum,
  patch: AlbumServerMetadataPatch,
): SubsonicAlbum {
  return {
    ...album,
    userRating: patch.userRating > 0 ? patch.userRating : undefined,
    ...('starred' in patch ? { starred: patch.starred } : {}),
    ...('discTitles' in patch ? { discTitles: patch.discTitles } : {}),
  };
}

/** Persist reconciled album favorite into the index (reconcile skips getAlbum mirror). */
export function patchAlbumStarToIndexFromReconcile(
  serverId: string,
  albumId: string,
  patch: AlbumServerMetadataPatch,
): void {
  if (!('starred' in patch)) return;
  if (!patch.starred) {
    patchLibraryAlbumOnUse(serverId, albumId, { starredAt: null });
    return;
  }
  const parsed = Date.parse(patch.starred);
  patchLibraryAlbumOnUse(serverId, albumId, {
    starredAt: Number.isFinite(parsed) ? parsed : Date.now(),
  });
}

/** A track whose server rating differs from the one the page painted (0 = unrated). */
export type TrackUserRatingChange = { id: string; userRating: number };

export function trackUserRating(song: SubsonicSong): number {
  return parseSubsonicEntityStarRating(song) ?? 0;
}

/** Whether `song` belongs to the server that answered `#getAlbum`. */
function songIsOnServer(song: SubsonicSong, serverId: string): boolean {
  return !song.serverId || song.serverId === serverId;
}

/**
 * Compare the songs painted from the local index with a fresh `#getAlbum`
 * body from `serverId`. A rating set on the server by another client never
 * reaches the index (delta sync only re-fetches tracks whose metadata
 * changed), so the album page is where it gets corrected. Songs missing from
 * either side, or owned by another server, are left alone.
 */
export function diffTrackUserRatings(
  serverId: string,
  local: SubsonicSong[],
  server: SubsonicSong[],
): TrackUserRatingChange[] {
  const serverById = new Map(server.map(song => [song.id, song]));
  const changes: TrackUserRatingChange[] = [];
  for (const song of local) {
    if (!songIsOnServer(song, serverId)) continue;
    const fresh = serverById.get(song.id);
    if (!fresh) continue;
    const userRating = trackUserRating(fresh);
    if (userRating !== trackUserRating(song)) changes.push({ id: song.id, userRating });
  }
  return changes;
}

export function applyTrackUserRatings(
  serverId: string,
  songs: SubsonicSong[],
  changes: TrackUserRatingChange[],
): SubsonicSong[] {
  if (changes.length === 0) return songs;
  const ratingById = new Map(changes.map(change => [change.id, change.userRating]));
  return songs.map(song => {
    const userRating = songIsOnServer(song, serverId) ? ratingById.get(song.id) : undefined;
    if (userRating === undefined) return song;
    return { ...song, userRating: userRating > 0 ? userRating : undefined };
  });
}

/** Persist reconciled track ratings into the index so the next local paint is right. */
export function patchTrackRatingsToIndexFromReconcile(
  serverId: string,
  changes: TrackUserRatingChange[],
): void {
  for (const change of changes) {
    patchLibraryTrackOnUse(serverId, change.id, { userRating: change.userRating });
  }
}

export type AlbumServerMetadataReconcileFetch = {
  server: SubsonicAlbum;
  songs: SubsonicSong[];
};

/**
 * Fetch album metadata from the server for background reconcile. Does not
 * mirror into the index — callers apply a fresh diff against current UI state.
 */
export async function fetchAlbumServerMetadataForReconcile(
  serverId: string,
  albumId: string,
): Promise<AlbumServerMetadataReconcileFetch | null> {
  const { album: server, songs } = await getAlbumForServer(serverId, albumId, { mirrorToIndex: false });
  return { server, songs };
}

/** @deprecated use {@link fetchAlbumServerMetadataForReconcile} + fresh diff */
export async function fetchAlbumServerMetadataPatch(
  serverId: string,
  albumId: string,
  local: SubsonicAlbum,
): Promise<AlbumServerMetadataPatch | null> {
  const fetched = await fetchAlbumServerMetadataForReconcile(serverId, albumId);
  if (!fetched) return null;
  return diffAlbumServerMetadata(local, fetched.server);
}
