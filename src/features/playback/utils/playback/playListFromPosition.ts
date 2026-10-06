import type { Track } from '@/lib/media/trackTypes';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { type QueueSource, withQueueSource } from '@/features/playback/store/pendingQueueSource';
import { setSeekFallbackVisualTarget } from '@/features/playback/store/seekFallbackState';

/**
 * Replace the queue with `tracks` and start the one at `index` from
 * `positionSec`. The position rides on the seek-fallback target, which
 * `playTrack` reads as the start time and seeks to once the engine plays — the
 * same hand-off the audio-device bridge uses to restart a track mid-way.
 */
export function playListFromPosition(
  tracks: Track[],
  index: number,
  positionSec: number,
  source: QueueSource,
): void {
  const track = tracks[index];
  if (!track) return;
  setSeekFallbackVisualTarget(positionSec > 0.5
    ? { trackId: track.id, seconds: positionSec, setAtMs: Date.now() }
    : null);
  withQueueSource(source, () => usePlayerStore.getState().playTrack(track, tracks, true, false, index));
}
