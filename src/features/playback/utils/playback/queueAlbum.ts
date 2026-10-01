import type { QueueItemRef, Track } from '@/lib/media/trackTypes';
import { playbackProfileIdForTrack } from '@/features/playback/utils/playback/playbackServer';
import { resolveQueueTrack } from '@/features/playback/store/queueTrackView';

/**
 * Whether two queue entries belong to the same album on the same server. A
 * track without an album id is an album of its own, so it never joins its
 * neighbours.
 */
export function sameQueueAlbum(
  a: Track,
  aRef: QueueItemRef | undefined,
  b: Track,
  bRef: QueueItemRef | undefined,
): boolean {
  if (!a.albumId || !b.albumId || a.albumId !== b.albumId) return false;
  return playbackProfileIdForTrack(a, aRef) === playbackProfileIdForTrack(b, bRef);
}

function sameAlbumAt(items: QueueItemRef[], i: number, j: number): boolean {
  return sameQueueAlbum(resolveQueueTrack(items[i]), items[i], resolveQueueTrack(items[j]), items[j]);
}

/** Index where the run of same-album entries around `index` starts. */
export function queueAlbumStart(items: QueueItemRef[], index: number): number {
  let start = index;
  while (start > 0 && sameAlbumAt(items, start - 1, index)) start--;
  return start;
}

/** First index after the album run containing `index`, or null when no other album follows. */
export function nextQueueAlbumStart(items: QueueItemRef[], index: number): number | null {
  for (let i = index + 1; i < items.length; i++) {
    if (!sameAlbumAt(items, i, index)) return i;
  }
  return null;
}
