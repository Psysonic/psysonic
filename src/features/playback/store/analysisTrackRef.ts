import type { QueueItemRef, Track } from '@/lib/media/trackTypes';
import {
  resolveStorageServerIndexKey,
  serverIndexKeyForProfile,
} from '@/lib/server/serverIndexKey';
import { useAuthStore } from '@/store/authStore';
import { queueTrackIdentityKey } from '@/features/playback/utils/playback/queueIdentity';

export type AnalysisTrackRef = Readonly<{
  trackId: string;
  serverIndexKey: string | null;
}>;

/**
 * Analysis writes `track_fact` rows keyed by the library's server key, so a
 * value that the library cannot resolve produces a `(server_id, track_id)`
 * foreign-key failure (issue #1434). The only value that must be refused here
 * is an ephemeral server-profile id; an address-derived key must always pass,
 * including one whose profile has since been removed, because the library keeps
 * those rows.
 *
 * The two cannot be separated by shape — a profile id is base36 and so is a
 * single-label hostname such as `mpserver01`. Identity therefore comes from the
 * store's own record of minted ids (`mintedServerProfileIds`), which the app
 * fills as it mints them: membership proves a profile id, absence proves the
 * value was never one.
 */
function resolveAnalysisServerIndexKey(serverIdOrIndexKey: string): string | null {
  const candidate = serverIdOrIndexKey.trim();
  const indexKey = resolveStorageServerIndexKey(candidate);
  if (!indexKey) return null;
  const { servers, mintedServerProfileIds } = useAuthStore.getState();
  if (servers?.some(s => s.id === candidate || serverIndexKeyForProfile(s) === candidate)) {
    return indexKey;
  }
  return mintedServerProfileIds?.includes(candidate) ? null : indexKey;
}

export function analysisTrackRef(
  trackId: string,
  serverIdOrIndexKey?: string | null,
): AnalysisTrackRef {
  return {
    trackId,
    serverIndexKey: serverIdOrIndexKey
      ? resolveAnalysisServerIndexKey(serverIdOrIndexKey)
      : null,
  };
}

export function analysisTrackRefForTrack(
  track: Pick<Track, 'id' | 'serverId'>,
  queueRef?: Pick<QueueItemRef, 'serverId'> | null,
): AnalysisTrackRef {
  return analysisTrackRef(track.id, queueRef?.serverId ?? track.serverId);
}

export function analysisTrackRefForQueueItem(
  ref: Pick<QueueItemRef, 'trackId' | 'serverId'>,
): AnalysisTrackRef {
  return analysisTrackRef(ref.trackId, ref.serverId);
}

export function analysisTrackRefKey(ref: AnalysisTrackRef): string {
  return queueTrackIdentityKey(ref.trackId, ref.serverIndexKey);
}
