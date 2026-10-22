import type { PlayerState } from '@/features/playback/store/playerStoreTypes';
import { canonicalQueueServerKey } from '@/lib/server/serverIndexKey';

export type NowPlayingKind = 'album' | 'artist' | 'playlist';

/** Cards carry either a profile id or an index key; compare them in one shape. */
function sameServer(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b || a === b) return true;
  return canonicalQueueServerKey(a) === canonicalQueueServerKey(b);
}

/**
 * Whether the card for `kind`/`id` belongs to what is playing: an album or an
 * artist when the current track is theirs (wherever it was started from), a
 * playlist when the queue was started from it. Radio has no current track, so
 * nothing matches while it plays.
 */
export function nowPlayingMatches(
  state: Pick<PlayerState, 'currentTrack' | 'queueSource'>,
  kind: NowPlayingKind,
  id: string,
  serverId?: string,
): boolean {
  const track = state.currentTrack;
  if (!track || !id) return false;
  if (kind === 'album') {
    return track.albumId === id && sameServer(track.serverId, serverId);
  }
  if (kind === 'artist') {
    const credited = track.artistId === id || (track.artists?.some(artist => artist.id === id) ?? false);
    return credited && sameServer(track.serverId, serverId);
  }
  const source = state.queueSource;
  return source?.kind === 'playlist' && source.id === id && sameServer(source.serverId, serverId);
}
