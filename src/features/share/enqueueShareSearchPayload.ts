import type { TFunction } from 'i18next';
import { getSongForServer } from '@/lib/api/subsonicLibrary';
import type { SubsonicAlbum, SubsonicArtist, SubsonicPlaylist, SubsonicSong } from '@/lib/api/subsonicTypes';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { songToTrack } from '@/lib/media/songToTrack';
import type { Track } from '@/lib/media/trackTypes';
import { orbitBulkGuard } from '@/features/orbit';
import { resolveAlbum, resolveArtist, resolvePlaylist } from '@/store/mediaResolver';
import type {
  AlbumShareSearchPayload,
  ArtistShareSearchPayload,
  ComposerShareSearchPayload,
  PlaylistShareSearchPayload,
  QueueableShareSearchPayload,
} from '@/lib/share/shareSearch';
import { showToast } from '@/lib/dom/toast';
import {
  activateShareServer,
  lookupShareServer,
  type ShareServerLookupResult,
} from '@/features/share/shareServerResolution';
import { normalizeNavidromeExternalId } from '@/lib/server/navidromeCanonicalExternalId';

const RESOLVE_QUEUE_CHUNK = 12;

export type ShareSearchResolveResult =
  | { type: 'ok'; songs: SubsonicSong[]; total: number; skipped: number }
  | { type: 'not-logged-in' }
  | { type: 'no-matching-server'; url: string }
  | { type: 'all-unavailable' }
  | { type: 'error' };

export type ShareSearchAlbumResolveResult =
  | { type: 'ok'; album: SubsonicAlbum }
  | { type: 'not-logged-in' }
  | { type: 'no-matching-server'; url: string }
  | { type: 'unavailable' }
  | { type: 'error' };

export type ShareSearchArtistResolveResult =
  | { type: 'ok'; artist: SubsonicArtist }
  | { type: 'not-logged-in' }
  | { type: 'no-matching-server'; url: string }
  | { type: 'unavailable' }
  | { type: 'error' };

export type ShareSearchPlaylistResolveResult =
  | { type: 'ok'; playlist: SubsonicPlaylist }
  | { type: 'not-logged-in' }
  | { type: 'no-matching-server'; url: string }
  | { type: 'unavailable' }
  | { type: 'error' };

export function activateShareSearchServer(shareSrv: string, t: TFunction): boolean {
  const lookup = lookupShareServer(shareSrv);
  if (lookup.type === 'not-logged-in') {
    showToast(t('sharePaste.notLoggedIn'), 4000, 'info');
    return false;
  }
  if (lookup.type === 'no-matching-server') {
    showToast(t('sharePaste.noMatchingServer', { url: lookup.url }), 6000, 'error');
    return false;
  }

  activateShareServer(lookup.serverId);
  return true;
}

async function resolveSharedSong(
  id: string,
  lookup: Extract<ShareServerLookupResult, { type: 'ok' }>,
): Promise<SubsonicSong | null> {
  return getSongForServer(lookup.serverId, id);
}

export async function resolveShareSearchPayload(
  payload: QueueableShareSearchPayload,
): Promise<ShareSearchResolveResult> {
  const lookup = lookupShareServer(payload.srv);
  if (lookup.type === 'not-logged-in') {
    return { type: 'not-logged-in' };
  }
  if (lookup.type === 'no-matching-server') {
    return { type: 'no-matching-server', url: lookup.url };
  }

  try {
    const ids = (payload.k === 'track' ? [payload.id] : payload.ids)
      .map(id => normalizeNavidromeExternalId(lookup.serverId, id));
    const resolved: SubsonicSong[] = [];
    for (let i = 0; i < ids.length; i += RESOLVE_QUEUE_CHUNK) {
      const chunk = ids.slice(i, i + RESOLVE_QUEUE_CHUNK);
      const songs = await Promise.all(chunk.map(id => resolveSharedSong(id, lookup)));
      for (const song of songs) {
        if (song) resolved.push(song);
      }
    }

    const skipped = ids.length - resolved.length;
    if (resolved.length === 0) {
      return { type: 'all-unavailable' };
    }

    return { type: 'ok', songs: resolved, total: ids.length, skipped };
  } catch {
    return { type: 'error' };
  }
}

export async function resolveShareSearchAlbum(
  payload: AlbumShareSearchPayload,
): Promise<ShareSearchAlbumResolveResult> {
  const lookup = lookupShareServer(payload.srv);
  if (lookup.type === 'not-logged-in') {
    return { type: 'not-logged-in' };
  }
  if (lookup.type === 'no-matching-server') {
    return { type: 'no-matching-server', url: lookup.url };
  }

  try {
    const id = normalizeNavidromeExternalId(lookup.serverId, payload.id);
    const resolved = await resolveAlbum(lookup.serverId, id);
    return resolved
      ? { type: 'ok', album: { ...resolved.album, serverId: lookup.serverId } }
      : { type: 'unavailable' };
  } catch {
    return { type: 'unavailable' };
  }
}

export async function resolveShareSearchArtist(
  payload: ArtistShareSearchPayload | ComposerShareSearchPayload,
): Promise<ShareSearchArtistResolveResult> {
  const lookup = lookupShareServer(payload.srv);
  if (lookup.type === 'not-logged-in') {
    return { type: 'not-logged-in' };
  }
  if (lookup.type === 'no-matching-server') {
    return { type: 'no-matching-server', url: lookup.url };
  }

  try {
    const id = normalizeNavidromeExternalId(lookup.serverId, payload.id);
    const resolved = await resolveArtist(lookup.serverId, id);
    return resolved
      ? { type: 'ok', artist: { ...resolved.artist, serverId: lookup.serverId } }
      : { type: 'unavailable' };
  } catch {
    return { type: 'unavailable' };
  }
}

export async function resolveShareSearchPlaylist(
  payload: PlaylistShareSearchPayload,
): Promise<ShareSearchPlaylistResolveResult> {
  const lookup = lookupShareServer(payload.srv);
  if (lookup.type === 'not-logged-in') {
    return { type: 'not-logged-in' };
  }
  if (lookup.type === 'no-matching-server') {
    return { type: 'no-matching-server', url: lookup.url };
  }

  try {
    const id = normalizeNavidromeExternalId(lookup.serverId, payload.id);
    const resolved = await resolvePlaylist(lookup.serverId, id);
    return resolved
      ? { type: 'ok', playlist: { ...resolved.playlist, serverId: lookup.serverId } }
      : { type: 'unavailable' };
  } catch {
    return { type: 'unavailable' };
  }
}

export async function enqueueShareSearchPayload(
  payload: QueueableShareSearchPayload,
  t: TFunction,
): Promise<boolean> {
  const resolved = await resolveShareSearchPayload(payload);
  if (resolved.type === 'not-logged-in') {
    showToast(t('sharePaste.notLoggedIn'), 4000, 'info');
    return false;
  }
  if (resolved.type === 'no-matching-server') {
    showToast(t('sharePaste.noMatchingServer', { url: resolved.url }), 6000, 'error');
    return false;
  }
  if (resolved.type === 'all-unavailable') {
    showToast(
      payload.k === 'track' ? t('sharePaste.trackUnavailable') : t('sharePaste.queueAllUnavailable'),
      payload.k === 'track' ? 5000 : 6000,
      'error',
    );
    return false;
  }
  if (resolved.type === 'error') {
    showToast(t('sharePaste.genericError'), 5000, 'error');
    return false;
  }

  try {
    const tracks: Track[] = resolved.songs.map(songToTrack);
    const okToEnqueue = await orbitBulkGuard(tracks.length);
    if (!okToEnqueue) return false;
    if (!activateShareSearchServer(payload.srv, t)) return false;
    usePlayerStore.getState().enqueue(tracks, true);
    if (resolved.skipped > 0) {
      showToast(
        t('search.shareQueuedPartial', { queued: tracks.length, total: resolved.total, skipped: resolved.skipped }),
        5000,
        'info',
      );
    } else {
      showToast(t('search.shareQueued', { count: tracks.length }), 3000, 'info');
    }
    return true;
  } catch (e) {
    console.error('[psysonic] share search enqueue failed', e);
    showToast(t('sharePaste.genericError'), 5000, 'error');
    return false;
  }
}
