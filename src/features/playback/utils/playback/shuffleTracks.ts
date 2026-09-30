import { useAuthStore } from '@/store/authStore';
import type { QueueItemRef, Track } from '@/lib/media/trackTypes';
import { shuffleArray } from '@/lib/util/shuffleArray';
import { spreadShuffle, type ShuffleGroupKeys } from '@/lib/util/spreadShuffle';

/**
 * The one place a list the user asked to hear mixed gets its order: the shuffle
 * mode, "shuffle queue", and every "shuffle play" button. With Smart Shuffle on
 * (the default) artists and their albums are spread over the list; off, it is
 * plain Fisher-Yates.
 *
 * Discovery pools (radio, Instant Mix, random rails, infinite-queue top-ups)
 * deliberately keep `shuffleArray` — they pick *which* tracks to offer, and
 * their order is not what the user asked to shuffle.
 */

type ShuffleKeySource = Pick<Track, 'artist' | 'artists' | 'album' | 'albumId' | 'serverId'>;

/**
 * Artist first, then album: the two repeats a listener notices. The primary
 * performer counts, not the credit string, so "A feat. B" still groups with A.
 */
export function trackShuffleKeys(track: ShuffleKeySource): ShuffleGroupKeys | null {
  const artist = (track.artists?.[0]?.name ?? track.artist ?? '').trim().toLowerCase();
  const album = track.albumId
    ? `${track.serverId ?? ''}:${track.albumId}`
    : (track.album ?? '').trim().toLowerCase();
  if (!artist && !album) return null;
  return { primary: artist, secondary: album };
}

function smartShuffleEnabled(): boolean {
  return useAuthStore.getState().smartShuffleEnabled;
}

/**
 * `previous` is the track that plays right before the mixed list (the one that
 * keeps playing, or the one the user picked to start with), so the list does
 * not open with its artist again.
 */
export function shuffleTracks<T extends ShuffleKeySource>(tracks: T[], previous?: ShuffleKeySource): T[] {
  if (!smartShuffleEnabled()) return shuffleArray(tracks);
  return spreadShuffle(tracks, trackShuffleKeys, { leading: previous ? trackShuffleKeys(previous) : null });
}

/**
 * Queue refs carry no metadata, so the caller hands in a lookup (the queue
 * resolver's cache). Refs it cannot resolve yet are mixed in at random.
 */
export function shuffleQueueRefs(
  refs: QueueItemRef[],
  lookup: (ref: QueueItemRef) => ShuffleKeySource | undefined,
  previous?: QueueItemRef,
): QueueItemRef[] {
  if (!smartShuffleEnabled()) return shuffleArray(refs);
  const keysOf = (ref: QueueItemRef) => {
    const track = lookup(ref);
    return track ? trackShuffleKeys(track) : null;
  };
  return spreadShuffle(refs, keysOf, { leading: previous ? keysOf(previous) : null });
}
