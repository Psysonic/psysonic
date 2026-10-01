import type { QueueItemRef } from '@/lib/media/trackTypes';
import { sanitizePauseResumeFadeSecs } from '@/lib/audio/pauseResumeFade';
import { useAuthStore } from '@/store/authStore';
import type { AuthState } from '@/store/authStoreTypes';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import type { PlayerState, SleepBoundary } from '@/features/playback/store/playerStoreTypes';
import { effectivePlaybackRate } from '@/features/playback/store/playbackReportSession';
import { getPlaybackProgressSnapshot } from '@/features/playback/store/playbackProgress';
import { resolveQueueTrack } from '@/features/playback/store/queueTrackView';
import {
  clearScheduledPauseTimers,
  schedulePauseTimer,
} from '@/features/playback/store/scheduleTimers';
import {
  clampCrossfadeSecs,
  nextQueueRefForTransition,
} from '@/features/playback/utils/playback/autodjAutoAdvance';
import { playbackProfileIdForTrack } from '@/features/playback/utils/playback/playbackServer';
import { queueTrackIdentityKey } from '@/features/playback/utils/playback/queueIdentity';
import { sameQueueAlbum } from '@/features/playback/utils/playback/queueAlbum';

/**
 * Sleep timer bound to the music: pause at the end of the track, or where the
 * queue moves on to another album.
 *
 * The pause is placed just before the boundary rather than on it, so the next
 * track never starts: a gapless chain or crossfade would already be playing it
 * by the time the boundary event reaches the frontend. Progress ticks arrive
 * about once a second, so the last stretch is timed by a short one-shot timer
 * armed from the tick that sees it coming.
 */

/** Pause this far before the boundary on top of fade and crossfade time. */
const END_MARGIN_SEC = 0.5;
/** Arm the one-shot timer once the pause point is this close. */
const ARM_WINDOW_SEC = 3;
/** Refresh the countdown estimate only when it drifts by more than this. */
const ESTIMATE_DRIFT_MS = 2000;

type BoundaryState = Pick<PlayerState, 'currentTrack' | 'queueItems' | 'queueIndex' | 'repeatMode'>;

/** The ref that plays after the current one, as the queue will actually move. */
function nextRefFor(state: BoundaryState): QueueItemRef | null {
  if (state.repeatMode === 'one') return state.queueItems[state.queueIndex] ?? null;
  return nextQueueRefForTransition(state.queueItems, state.queueIndex, state.repeatMode);
}

/** Whether the boundary falls at the end of the track that is playing now. */
export function sleepBoundaryEndsWithCurrentTrack(boundary: SleepBoundary, state: BoundaryState): boolean {
  if (boundary === 'track') return true;
  const current = state.currentTrack;
  if (!current) return true;
  const nextRef = nextRefFor(state);
  if (!nextRef) return true;
  return !sameQueueAlbum(current, state.queueItems[state.queueIndex], resolveQueueTrack(nextRef), nextRef);
}

/** Seconds before the end of the boundary track at which the pause starts. */
export function sleepBoundaryLeadSec(
  auth: Pick<AuthState, 'pauseResumeFadeEnabled' | 'pauseResumeFadeSecs' | 'crossfadeEnabled' | 'crossfadeSecs' | 'gaplessEnabled'>,
): number {
  const fade = auth.pauseResumeFadeEnabled ? sanitizePauseResumeFadeSecs(auth.pauseResumeFadeSecs) : 0;
  const crossfade = auth.crossfadeEnabled && !auth.gaplessEnabled ? clampCrossfadeSecs(auth.crossfadeSecs) : 0;
  return fade + crossfade + END_MARGIN_SEC;
}

/**
 * Track seconds from `currentTime` to the boundary: the rest of this track, plus
 * the following tracks of the same album in album mode.
 */
export function sleepBoundaryRemainingTrackSec(
  boundary: SleepBoundary,
  state: BoundaryState,
  currentTime: number,
  duration: number,
): number {
  let total = Math.max(0, duration - currentTime);
  if (boundary === 'album' && state.currentTrack) {
    let prev = state.currentTrack;
    let prevRef = state.queueItems[state.queueIndex];
    for (let i = state.queueIndex + 1; i < state.queueItems.length; i++) {
      const ref = state.queueItems[i];
      const track = resolveQueueTrack(ref);
      if (!sameQueueAlbum(prev, prevRef, track, ref)) break;
      total += Math.max(0, track.duration || 0);
      prev = track;
      prevRef = ref;
    }
  }
  return total;
}

function currentPlayKey(state: Pick<PlayerState, 'currentTrack' | 'queueItems' | 'queueIndex'>): string | null {
  const track = state.currentTrack;
  if (!track) return null;
  return `${state.queueIndex}:${queueTrackIdentityKey(track.id, playbackProfileIdForTrack(track, state.queueItems[state.queueIndex]))}`;
}

function refreshEstimate(boundary: SleepBoundary, currentTime: number, duration: number): void {
  const state = usePlayerStore.getState();
  const rate = effectivePlaybackRate();
  const remainingSec = sleepBoundaryRemainingTrackSec(boundary, state, currentTime, duration)
    - sleepBoundaryLeadSec(useAuthStore.getState());
  const estimate = Date.now() + Math.max(0, remainingSec / rate) * 1000;
  if (state.scheduledPauseAtMs == null || Math.abs(estimate - state.scheduledPauseAtMs) > ESTIMATE_DRIFT_MS) {
    usePlayerStore.setState({ scheduledPauseAtMs: estimate });
  }
}

function pauseAtBoundary(): void {
  usePlayerStore.getState().pause();
}

/**
 * Called from every engine progress tick while a track plays. Keeps the
 * countdown estimate current and, once the pause point is near, arms the
 * one-shot timer. Returns true when it paused right away (the pause point has
 * already passed), so the caller stops before advancing the queue.
 */
export function handleSleepBoundaryProgress(currentTime: number, duration: number): boolean {
  const state = usePlayerStore.getState();
  const boundary = state.scheduledPauseBoundary;
  if (!boundary || !state.isPlaying || state.currentRadio || !state.currentTrack || duration <= 0) return false;

  refreshEstimate(boundary, currentTime, duration);
  if (!sleepBoundaryEndsWithCurrentTrack(boundary, state)) return false;

  const rate = effectivePlaybackRate();
  const pauseAtSec = duration - sleepBoundaryLeadSec(useAuthStore.getState());
  const waitSec = (pauseAtSec - currentTime) / rate;
  if (waitSec <= 0) {
    pauseAtBoundary();
    return true;
  }
  if (waitSec > ARM_WINDOW_SEC) return false;

  const armedFor = currentPlayKey(state);
  schedulePauseTimer(waitSec * 1000, () => {
    const live = usePlayerStore.getState();
    if (live.scheduledPauseBoundary !== boundary || !live.isPlaying || currentPlayKey(live) !== armedFor) return;
    pauseAtBoundary();
  });
  return false;
}

/**
 * Arm the music-bound sleep timer; replaces a running clock timer. Lives here
 * rather than among the store actions because it needs the queue helpers,
 * which import the player store themselves.
 */
export function scheduleSleepBoundaryPause(boundary: SleepBoundary): void {
  const state = usePlayerStore.getState();
  if (!state.isPlaying || state.currentRadio || !state.currentTrack) return;
  clearScheduledPauseTimers();
  usePlayerStore.setState({
    scheduledPauseBoundary: boundary,
    scheduledPauseAtMs: null,
    scheduledPauseStartMs: Date.now(),
  });
  handleSleepBoundaryProgress(getPlaybackProgressSnapshot().currentTime, state.currentTrack.duration);
}

/**
 * A transition point the frontend drives itself (the trimmed-silence crossfade
 * advance): pause there instead of moving on when the boundary is reached.
 */
export function pauseAtSleepBoundaryInsteadOfAdvance(): boolean {
  const state = usePlayerStore.getState();
  const boundary = state.scheduledPauseBoundary;
  if (!boundary || !sleepBoundaryEndsWithCurrentTrack(boundary, state)) return false;
  pauseAtBoundary();
  return true;
}

/**
 * The boundary track ran out before the pause could land (its real length was
 * shorter than reported). Returns true when the queue must not move on; the
 * sleep timer is spent either way the boundary was reached.
 */
export function consumeSleepBoundaryAtTrackEnd(state: BoundaryState & Pick<PlayerState, 'scheduledPauseBoundary'>): boolean {
  const boundary = state.scheduledPauseBoundary;
  if (!boundary || !sleepBoundaryEndsWithCurrentTrack(boundary, state)) return false;
  clearScheduledPauseTimers();
  usePlayerStore.setState({ scheduledPauseAtMs: null, scheduledPauseStartMs: null, scheduledPauseBoundary: null });
  return true;
}
