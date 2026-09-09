import { useCallback } from 'react';
import { setRating } from '@/lib/api/subsonicStarRating';
import { queueSongRating } from '@/features/playback/store/pendingStarSync';
import type { SubsonicAlbum, SubsonicArtist } from '@/lib/api/subsonicTypes';
import type { Track } from '@/lib/media/trackTypes';
import { multiTrackRatingId, unifiedTrackRating } from '@/lib/media/trackRating';
import { useAuthStore } from '@/store/authStore';
import { showToast } from '@/lib/dom/toast';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';

type RatingKind = 'song' | 'album' | 'artist';

interface Args {
  type: string | null;
  item: unknown;
  userRatingOverrides: Record<string, number>;
  setUserRatingOverride: (id: string, rating: number) => void;
  entityRatingSupport: 'full' | 'track_only' | 'unknown';
  t: (key: string) => string;
}

interface Result {
  applySongRating: (song: Pick<Track, 'id' | 'serverId'>, rating: number) => void;
  applyAlbumRating: (album: SubsonicAlbum, rating: number) => void;
  applyArtistRating: (artist: SubsonicArtist, rating: number) => void;
  getRatingValueByKind: (kind: RatingKind, id: string) => number;
  commitRatingByKind: (kind: RatingKind, id: string, rating: number) => void;
}

export function useContextMenuRating({
  type, item, userRatingOverrides, setUserRatingOverride, entityRatingSupport, t,
}: Args): Result {
  const setEntityRatingSupport = useAuthStore(s => s.setEntityRatingSupport);
  const activeServerId = useAuthStore(s => s.activeServerId);

  const applySongRating = useCallback((song: Pick<Track, 'id' | 'serverId'>, rating: number) => {
    // F4: optimistic override + retry-with-backoff sync via the central helper.
    queueSongRating(song.id, rating, song.serverId, { scopedOverride: Boolean(song.serverId) });
  }, []);

  const applyAlbumRating = useCallback((album: SubsonicAlbum, rating: number) => {
    const ownerServerId = album.serverId ?? activeServerId ?? undefined;
    setUserRatingOverride(ownedEntityKey(album), rating);
    if (entityRatingSupport !== 'full') return;
    setRating(album.id, rating, { serverId: ownerServerId, kind: 'album' }).catch(err => {
      if (ownerServerId) setEntityRatingSupport(ownerServerId, 'track_only');
      showToast(
        typeof err === 'string' ? err : err instanceof Error ? err.message : t('entityRating.saveFailed'),
        4500,
        'error',
      );
    });
  }, [setUserRatingOverride, entityRatingSupport, activeServerId, setEntityRatingSupport, t]);

  const applyArtistRating = useCallback((artist: SubsonicArtist, rating: number) => {
    const ownerServerId = artist.serverId ?? activeServerId ?? undefined;
    setUserRatingOverride(ownedEntityKey(artist), rating);
    if (entityRatingSupport !== 'full') return;
    setRating(artist.id, rating, { serverId: ownerServerId, kind: 'artist' }).catch(err => {
      if (ownerServerId) setEntityRatingSupport(ownerServerId, 'track_only');
      showToast(
        typeof err === 'string' ? err : err instanceof Error ? err.message : t('entityRating.saveFailed'),
        4500,
        'error',
      );
    });
  }, [setUserRatingOverride, entityRatingSupport, activeServerId, setEntityRatingSupport, t]);

  const getRatingValueByKind = useCallback((kind: RatingKind, id: string): number => {
    if (kind === 'song' && (type === 'song' || type === 'album-song' || type === 'queue-item')) {
      const song = item as Track;
      if (song.id === id) return userRatingOverrides[ownedEntityKey(song)] ?? userRatingOverrides[id] ?? song.userRating ?? 0;
    }
    if (kind === 'song' && type === 'multi-song') {
      const songs = item as Track[];
      if (id !== multiTrackRatingId(songs)) return userRatingOverrides[id] ?? 0;
      return unifiedTrackRating(songs, userRatingOverrides);
    }
    if (kind === 'album' && type === 'album') {
      const album = item as SubsonicAlbum;
      if (album.id === id) return userRatingOverrides[ownedEntityKey(album)] ?? userRatingOverrides[id] ?? album.userRating ?? 0;
    }
    if (kind === 'album' && type === 'multi-album') {
      const albums = item as SubsonicAlbum[];
      const compositeId = [...albums.map(a => a.id)].sort().join('\x1e');
      if (id !== compositeId) return userRatingOverrides[id] ?? 0;
      if (albums.length === 0) return 0;
      const vals = albums.map(a => userRatingOverrides[ownedEntityKey(a)] ?? userRatingOverrides[a.id] ?? a.userRating ?? 0);
      const first = vals[0];
      return vals.every(v => v === first) ? first : 0;
    }
    if (kind === 'artist' && type === 'artist') {
      const artist = item as SubsonicArtist;
      if (artist.id === id) return userRatingOverrides[ownedEntityKey(artist)] ?? userRatingOverrides[id] ?? artist.userRating ?? 0;
    }
    if (kind === 'artist' && type === 'multi-artist') {
      const artists = item as SubsonicArtist[];
      const compositeId = [...artists.map(a => a.id)].sort().join('\x1e');
      if (id !== compositeId) return userRatingOverrides[id] ?? 0;
      if (artists.length === 0) return 0;
      const vals = artists.map(a => userRatingOverrides[ownedEntityKey(a)] ?? userRatingOverrides[a.id] ?? a.userRating ?? 0);
      const first = vals[0];
      return vals.every(v => v === first) ? first : 0;
    }
    return userRatingOverrides[id] ?? 0;
  }, [type, item, userRatingOverrides]);

  const commitRatingByKind = useCallback((kind: RatingKind, id: string, rating: number) => {
    if (kind === 'song' && type === 'multi-song') {
      const songs = item as Track[];
      if (id !== multiTrackRatingId(songs)) return;
      for (const song of songs) applySongRating(song, rating);
      return;
    }
    if (kind === 'song') {
      const song = item as Track;
      applySongRating({ id, serverId: song.serverId }, rating);
      return;
    }
    if (kind === 'album' && type === 'album') {
      applyAlbumRating(item as SubsonicAlbum, rating);
      return;
    }
    if (kind === 'album' && type === 'multi-album') {
      const albums = item as SubsonicAlbum[];
      const compositeId = [...albums.map(a => a.id)].sort().join('\x1e');
      if (id !== compositeId) return;
      for (const a of albums) applyAlbumRating(a, rating);
      return;
    }
    if (kind === 'artist' && type === 'artist') {
      applyArtistRating(item as SubsonicArtist, rating);
      return;
    }
    if (kind === 'artist' && type === 'multi-artist') {
      const artists = item as SubsonicArtist[];
      const compositeId = [...artists.map(a => a.id)].sort().join('\x1e');
      if (id !== compositeId) return;
      for (const a of artists) applyArtistRating(a, rating);
    }
  }, [applySongRating, applyAlbumRating, applyArtistRating, type, item]);

  return { applySongRating, applyAlbumRating, applyArtistRating, getRatingValueByKind, commitRatingByKind };
}
