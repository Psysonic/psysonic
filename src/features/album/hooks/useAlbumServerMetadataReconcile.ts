import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/features/playback';
import type { SubsonicAlbum, SubsonicSong } from '@/lib/api/subsonicTypes';
import { shouldAttemptSubsonicForServer } from '@/lib/network/subsonicNetworkGuard';
import {
  albumIsStarred,
  albumUserRating,
  applyAlbumServerMetadataPatch,
  applyTrackUserRatings,
  diffAlbumServerMetadata,
  diffTrackUserRatings,
  fetchAlbumServerMetadataForReconcile,
  patchAlbumStarToIndexFromReconcile,
  patchTrackRatingsToIndexFromReconcile,
} from '@/lib/library/albumServerMetadataReconcile';
import { ownedOverrideValue } from '@/lib/util/ownedEntityKey';
import type { ResolvedAlbum } from '@/store/mediaResolver';

interface Args {
  serverId: string;
  albumId: string;
  album: SubsonicAlbum | undefined;
  /** Tracks as painted; their ratings are reconciled from the same `#getAlbum`. */
  songs: SubsonicSong[] | undefined;
  setAlbum: React.Dispatch<React.SetStateAction<ResolvedAlbum | null>>;
  /** Skip while offline browse or explicit offline-only policy. */
  enabled: boolean;
  /** When true, skip applying server metadata (user toggled star/rating). */
  userMutationInFlightRef: React.RefObject<boolean>;
  /** Clear optimistic star/rating overrides after server metadata is applied. */
  onReconcileApplied?: (albumId: string) => void;
}

/**
 * After album detail paints from the local index, reconcile album-level
 * metadata and track ratings against the server in the background.
 */
export function useAlbumServerMetadataReconcile({
  serverId,
  albumId,
  album,
  songs,
  setAlbum,
  enabled,
  userMutationInFlightRef,
  onReconcileApplied,
}: Args): void {
  const reconciledKeyRef = useRef<string | null>(null);
  const inFlightKeyRef = useRef<string | null>(null);
  const albumRef = useRef(album);
  const songsRef = useRef(songs);

  useEffect(() => {
    albumRef.current = album;
  }, [album]);

  useEffect(() => {
    songsRef.current = songs;
  }, [songs]);

  useEffect(() => {
    reconciledKeyRef.current = null;
    inFlightKeyRef.current = null;
  }, [serverId, albumId]);

  useEffect(() => {
    if (!enabled || !serverId || !albumId || !album || album.id !== albumId) return;
    if (!shouldAttemptSubsonicForServer(serverId)) return;
    if (userMutationInFlightRef.current) return;

    const reconcileKey = `${serverId}:${albumId}`;
    if (reconciledKeyRef.current === reconcileKey) return;

    inFlightKeyRef.current = reconcileKey;
    const snapshot = album;
    let cancelled = false;

    void (async () => {
      try {
        if (userMutationInFlightRef.current) return;
        const fetched = await fetchAlbumServerMetadataForReconcile(serverId, albumId);
        if (cancelled || !fetched || userMutationInFlightRef.current) return;

        const current = albumRef.current;
        if (
          !current
          || current.id !== albumId
          || albumIsStarred(current) !== albumIsStarred(snapshot)
          || albumUserRating(current) !== albumUserRating(snapshot)
        ) {
          return;
        }

        const patch = diffAlbumServerMetadata(current, fetched.server);
        // A track the user rated this session keeps its override: it is the
        // newer value, and the server may not have it yet.
        const ratingOverrides = usePlayerStore.getState().userRatingOverrides;
        const trackRatings = diffTrackUserRatings(serverId, songsRef.current ?? [], fetched.songs)
          .filter(change => ownedOverrideValue(ratingOverrides, { id: change.id, serverId }) === undefined);
        if (!patch && trackRatings.length === 0) return;

        setAlbum(prev =>
          prev && prev.album.id === albumId
            ? {
              ...prev,
              album: patch ? applyAlbumServerMetadataPatch(prev.album, patch) : prev.album,
              songs: applyTrackUserRatings(serverId, prev.songs, trackRatings),
            }
            : prev,
        );

        patchTrackRatingsToIndexFromReconcile(serverId, trackRatings);

        if (patch) {
          patchAlbumStarToIndexFromReconcile(serverId, albumId, patch);

          if (
            patch.userRating !== albumUserRating(current)
            || 'starred' in patch
          ) {
            onReconcileApplied?.(albumId);
          }
        }
        reconciledKeyRef.current = reconcileKey;
      } catch {
        /* offline / transient — keep local; allow retry */
      } finally {
        if (inFlightKeyRef.current === reconcileKey) {
          inFlightKeyRef.current = null;
        }
      }
    })();

    return () => {
      cancelled = true;
      if (inFlightKeyRef.current === reconcileKey) {
        inFlightKeyRef.current = null;
      }
    };
  }, [enabled, serverId, albumId, album, setAlbum, userMutationInFlightRef, onReconcileApplied]);
}
