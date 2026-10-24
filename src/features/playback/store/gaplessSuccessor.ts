import type { QueueItemRef, Track } from '@/lib/media/trackTypes';
import { resolveQueueTrack } from '@/features/playback/store/queueTrackView';

/** One successor policy for preparing and committing a gapless boundary. */
export function resolveGaplessSuccessor(
  queueItems: QueueItemRef[],
  queueIndex: number,
  repeatMode: 'off' | 'one' | 'all',
  currentTrack: Track | null,
): { nextTrack: Track | null; newIndex: number } {
  const nextIdx = queueIndex + 1;
  if (repeatMode === 'one' && currentTrack) {
    return { nextTrack: currentTrack, newIndex: queueIndex };
  }
  if (nextIdx < queueItems.length) {
    return { nextTrack: resolveQueueTrack(queueItems[nextIdx]), newIndex: nextIdx };
  }
  if (repeatMode === 'all' && queueItems.length > 0) {
    return { nextTrack: resolveQueueTrack(queueItems[0]), newIndex: 0 };
  }
  return { nextTrack: null, newIndex: queueIndex };
}
