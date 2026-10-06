import type { QueueItemRef, Track } from '@/lib/media/trackTypes';
import { isPrivateModeActive } from '@/features/privateMode';
import { useAuthStore } from '@/store/authStore';
import { getPlaybackProgressSnapshot } from '@/features/playback/store/playbackProgress';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { usePreviewStore } from '@/features/playback/store/previewStore';
import { scrobblePlayStartedAtMs } from '@/features/playback/store/scrobblePlaySession';
import { submitTrackScrobble } from '@/features/playback/store/submitTrackScrobble';
import { findQueueItemRefForTrack } from '@/features/playback/utils/playback/queueIdentity';
import { playbackProfileIdForTrack } from '@/features/playback/utils/playback/playbackServer';
import { emitNaturalTrackEnd } from '@/features/playback/store/naturalTrackEnd';

export function submitPlaybackTrackScrobble(
  track: Track,
  queueItems: QueueItemRef[],
  queueIndex: number,
  currentTimeSec = getPlaybackProgressSnapshot().currentTime,
): void {
  const ref = findQueueItemRefForTrack(queueItems, track, queueIndex);
  const serverId = playbackProfileIdForTrack(track, ref);
  const startedAtMs = scrobblePlayStartedAtMs(
    track.id,
    serverId,
    currentTimeSec,
  );
  submitTrackScrobble(track, serverId, startedAtMs);
}

export function forceScrobbleCurrentTrack(canScrobble: boolean): boolean {
  if (!useAuthStore.getState().forceScrobbleEnabled) return false;
  if (!canScrobble || usePreviewStore.getState().previewingId || isPrivateModeActive()) return false;

  const { currentTrack, currentRadio, scrobbled, queueItems, queueIndex, currentTime, isPlaying } =
    usePlayerStore.getState();
  if (!currentTrack || currentRadio || scrobbled) return false;

  usePlayerStore.setState({ scrobbled: true });
  submitPlaybackTrackScrobble(
    currentTrack,
    queueItems,
    queueIndex,
    isPlaying ? undefined : currentTime,
  );
  return true;
}

/** A natural handoff means the outgoing play completed even when progress events stopped early. */
export function scrobbleCurrentTrackAtNaturalBoundary(): boolean {
  // Every natural boundary passes through here, so the completion signal is
  // raised once for all of them, before the scrobble guards below.
  emitNaturalTrackEnd();
  const { currentTrack, currentRadio, scrobbled, queueItems, queueIndex } =
    usePlayerStore.getState();
  if (!currentTrack || currentRadio || scrobbled || isPrivateModeActive()) return false;

  usePlayerStore.setState({ scrobbled: true });
  submitPlaybackTrackScrobble(currentTrack, queueItems, queueIndex);
  return true;
}
