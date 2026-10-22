import { usePlayerStore } from '@/features/playback/store/playerStore';
import { getPlaybackProgressSnapshot } from '@/features/playback/store/playbackProgress';
import { resolveQueueTrack } from '@/features/playback/store/queueTrackView';
import {
  nextQueueAlbumStart,
  queueAlbumStart,
} from '@/features/playback/utils/playback/queueAlbum';

/** Same threshold as `previous()`: past it, "back" first restarts the track. */
const RESTART_THRESHOLD_SEC = 3;

function playQueueIndex(index: number): void {
  const state = usePlayerStore.getState();
  state.playTrack(resolveQueueTrack(state.queueItems[index]), undefined, true, false, index);
}

function canSkipAlbums(): boolean {
  const state = usePlayerStore.getState();
  return !state.currentRadio && !!state.currentTrack && state.queueItems.length > 0;
}

/** Jump to the first track of the next album in the queue; nothing when no other album follows. */
export function skipToNextAlbum(): void {
  if (!canSkipAlbums()) return;
  const { queueItems, queueIndex } = usePlayerStore.getState();
  const target = nextQueueAlbumStart(queueItems, queueIndex);
  if (target != null) playQueueIndex(target);
}

/**
 * Back to the start of the current album first, then to the previous album —
 * the way the previous-track button restarts the track before going back.
 */
export function skipToPreviousAlbum(): void {
  if (!canSkipAlbums()) return;
  const state = usePlayerStore.getState();
  const start = queueAlbumStart(state.queueItems, state.queueIndex);
  if (state.queueIndex > start) {
    playQueueIndex(start);
    return;
  }
  if (getPlaybackProgressSnapshot().currentTime > RESTART_THRESHOLD_SEC) {
    // Already on the album's first track: restart it, exactly as `previous()` does.
    state.previous();
    return;
  }
  if (start > 0) playQueueIndex(queueAlbumStart(state.queueItems, start - 1));
}
