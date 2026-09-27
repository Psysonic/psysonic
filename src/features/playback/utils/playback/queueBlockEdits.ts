import type { QueueItemRef, Track } from '@/lib/media/trackTypes';
import { queueItemRefMatchesTrack } from '@/features/playback/utils/playback/queueIdentity';
import { moveBlockToGap } from '@/lib/util/listReorder';

export interface QueueEdit {
  items: QueueItemRef[];
  queueIndex: number;
}

/** The entry that is playing right now: the one under the cursor if it matches, else the first match. */
function playingEntry(
  items: readonly QueueItemRef[],
  queueIndex: number,
  currentTrack: Track | null,
): QueueItemRef | undefined {
  if (!currentTrack) return undefined;
  const cursorRef = items[queueIndex];
  if (queueItemRefMatchesTrack(cursorRef, currentTrack)) return cursorRef;
  return items.find(ref => queueItemRefMatchesTrack(ref, currentTrack));
}

/**
 * Drop several entries at once, matched by object identity so two copies of
 * the same track are told apart. The playing entry always stays. Returns null
 * when nothing would change.
 */
export function planQueueItemsRemoval(
  items: readonly QueueItemRef[],
  queueIndex: number,
  currentTrack: Track | null,
  refs: readonly QueueItemRef[],
): QueueEdit | null {
  const doomed = new Set(refs);
  const playingRef = playingEntry(items, queueIndex, currentTrack);
  if (playingRef) doomed.delete(playingRef);
  const next = items.filter(ref => !doomed.has(ref));
  if (next.length === items.length) return null;

  // Follow the playing entry (or, with nothing playing, the one under the
  // cursor). If the cursor's own entry went, land on the first survivor after it.
  const followRef = playingRef ?? items[queueIndex];
  const nextIndex = followRef && !doomed.has(followRef)
    ? next.indexOf(followRef)
    : items.slice(0, queueIndex).filter(ref => !doomed.has(ref)).length;
  return { items: next, queueIndex: Math.max(0, Math.min(nextIndex, next.length - 1)) };
}

/**
 * Move the entries at `indices` as one block, keeping their order, into the gap
 * before `gapIndex`. Both are counted in `items` as it is now, so `gapIndex` is
 * exactly the line a drop indicator shows. Returns null when nothing would move.
 */
export function planQueueItemsMove(
  items: readonly QueueItemRef[],
  queueIndex: number,
  currentTrack: Track | null,
  indices: readonly number[],
  gapIndex: number,
): QueueEdit | null {
  const next = moveBlockToGap(items, indices, gapIndex);
  if (!next) return null;

  const playingRef = playingEntry(items, queueIndex, currentTrack);
  const followRef = playingRef ?? items[queueIndex];
  const nextIndex = followRef ? next.indexOf(followRef) : queueIndex;
  return { items: next, queueIndex: Math.max(0, nextIndex) };
}
