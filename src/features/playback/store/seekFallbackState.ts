import { audioSeek } from '@/lib/api/audio';
import { isRecoverableSeekError } from '@/features/playback/utils/audio/seekErrors';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { setSeekTarget } from '@/features/playback/store/seekTargetState';
import { emitPlaybackSeek } from '@/features/playback/store/playbackProgress';
import {
  _resetSeekRequestStateForTest,
  beginSeekRequest as beginSeekRequestState,
  completeSeekRequest,
  getSeekFallbackRestartAt,
  getSeekFallbackTrackId,
  getSeekRequestRollback,
  isSeekRequestCurrent,
  preserveSeekRequestAcrossNextPlaybackReset,
  resetSeekRequestForPlaybackChange,
  setSeekFallbackRestartAt,
  setSeekFallbackTrackId,
} from '@/features/playback/store/seekRequestState';

export {
  completeSeekRequest,
  getSeekFallbackRestartAt,
  getSeekFallbackTrackId,
  isSeekRequestCurrent,
  preserveSeekRequestAcrossNextPlaybackReset,
  setSeekFallbackRestartAt,
  setSeekFallbackTrackId,
};

/**
 * Streaming-fallback seek recovery + visual coverup.
 *
 * The Rust seek pipeline can reject a seek as "not seekable" while the
 * stream is still settling (sink not bound yet, codec hasn't reported
 * seekability). Instead of surfacing the failure straight away, this
 * module schedules bounded retries every 180 ms up to a 6 s ceiling.
 *
 * In parallel, `seekFallbackVisualTarget` holds the seekbar at the
 * requested position so the user doesn't see it snap back to the
 * pre-seek time while the retry loop is in flight. The progress handler
 * reads this and prefers the target value until the engine actually
 * reaches it (within ~2 s) or the 1.6 s visual-guard window elapses.
 *
 * `seekFallbackTrackId` + `seekFallbackRestartAt` track the most recent
 * fallback-restart so a quick subsequent seek on the same track can
 * decide whether to debounce a full restart vs reuse the loop.
 */

export const SEEK_FALLBACK_VISUAL_GUARD_MS = 1600;
export const SEEK_FALLBACK_RETRY_INTERVAL_MS = 180;
export const SEEK_FALLBACK_RETRY_MAX_MS = 6000;

let seekFallbackRetryTimer: ReturnType<typeof setTimeout> | null = null;
let seekFallbackRetryStartedAt = 0;
let seekFallbackRetryTarget: {
  trackId: string;
  seconds: number;
  requestGeneration: number;
} | null = null;
let seekFallbackVisualTarget: {
  trackId: string;
  seconds: number;
  setAtMs: number;
  requestGeneration?: number;
} | null = null;

export function beginSeekRequest(
  trackId: string,
  rollbackTime: number,
  rollbackProgress: number,
): number {
  const generation = beginSeekRequestState(trackId, rollbackTime, rollbackProgress);
  clearSeekFallbackRetry();
  seekFallbackVisualTarget = null;
  return generation;
}

export function rollbackSeekRequest(
  generation: number,
  trackId: string,
  failedTarget: number,
): void {
  const rollback = getSeekRequestRollback(generation, trackId);
  if (!rollback) return;
  const state = usePlayerStore.getState();
  if (
    !state.isPlaying
    && state.currentTrack?.id === trackId
    && Math.abs(state.currentTime - failedTarget) < 0.25
  ) {
    usePlayerStore.setState({
      currentTime: rollback.time,
      progress: rollback.progress,
    });
    emitPlaybackSeek(rollback.time);
  }
  completeSeekRequest(generation, trackId);
}

export function resetSeekStateForPlaybackChange(): void {
  if (!resetSeekRequestForPlaybackChange()) return;
  clearSeekFallbackRetry();
  seekFallbackVisualTarget = null;
}

export function clearSeekFallbackRetry(): void {
  if (seekFallbackRetryTimer) {
    clearTimeout(seekFallbackRetryTimer);
    seekFallbackRetryTimer = null;
  }
  seekFallbackRetryStartedAt = 0;
  seekFallbackRetryTarget = null;
}

export function scheduleSeekFallbackRetry(
  trackId: string,
  seconds: number,
  requestGeneration = 0,
): void {
  const now = Date.now();
  if (
    !seekFallbackRetryTarget
    || seekFallbackRetryTarget.trackId !== trackId
    || Math.abs(seekFallbackRetryTarget.seconds - seconds) > 0.25
    || seekFallbackRetryTarget.requestGeneration !== requestGeneration
  ) {
    clearSeekFallbackRetry();
    seekFallbackRetryStartedAt = now;
    seekFallbackRetryTarget = { trackId, seconds, requestGeneration };
  } else if (seekFallbackRetryStartedAt === 0) {
    seekFallbackRetryStartedAt = now;
  }
  if (seekFallbackRetryTimer) clearTimeout(seekFallbackRetryTimer);
  seekFallbackRetryTimer = setTimeout(() => {
    seekFallbackRetryTimer = null;
    const target = seekFallbackRetryTarget;
    const s = usePlayerStore.getState();
    if (
      target?.requestGeneration
      && !isSeekRequestCurrent(target.requestGeneration, target.trackId)
    ) {
      return;
    }
    if (!target || !s.currentTrack || s.currentTrack.id !== target.trackId) {
      clearSeekFallbackRetry();
      return;
    }
    if (Date.now() - seekFallbackRetryStartedAt > SEEK_FALLBACK_RETRY_MAX_MS) {
      clearSeekFallbackRetry();
      seekFallbackVisualTarget = null;
      if (target.requestGeneration) {
        rollbackSeekRequest(target.requestGeneration, target.trackId, target.seconds);
      }
      return;
    }
    audioSeek({ seconds: target.seconds }).then(() => {
      if (
        target.requestGeneration
        && !isSeekRequestCurrent(target.requestGeneration, target.trackId)
      ) return;
      setSeekTarget(target.seconds);
      seekFallbackVisualTarget = null;
      clearSeekFallbackRetry();
      if (target.requestGeneration) {
        completeSeekRequest(target.requestGeneration, target.trackId);
      }
    }).catch((err: unknown) => {
      if (
        target.requestGeneration
        && !isSeekRequestCurrent(target.requestGeneration, target.trackId)
      ) return;
      const msg = String(err ?? '');
      if (!isRecoverableSeekError(msg)) {
        console.error(err);
        seekFallbackVisualTarget = null;
        clearSeekFallbackRetry();
        if (target.requestGeneration) {
          rollbackSeekRequest(target.requestGeneration, target.trackId, target.seconds);
        }
        return;
      }
      scheduleSeekFallbackRetry(target.trackId, target.seconds, target.requestGeneration);
    });
  }, SEEK_FALLBACK_RETRY_INTERVAL_MS);
}

export type SeekFallbackVisualTarget = {
  trackId: string;
  seconds: number;
  setAtMs: number;
  requestGeneration?: number;
};

export function getSeekFallbackVisualTarget(): SeekFallbackVisualTarget | null {
  if (
    seekFallbackVisualTarget?.requestGeneration
    && !isSeekRequestCurrent(
      seekFallbackVisualTarget.requestGeneration,
      seekFallbackVisualTarget.trackId,
    )
  ) {
    seekFallbackVisualTarget = null;
  }
  return seekFallbackVisualTarget;
}

export function setSeekFallbackVisualTarget(target: SeekFallbackVisualTarget | null): void {
  seekFallbackVisualTarget = target;
}

/** Test-only: reset every mutable to its initial value. */
export function _resetSeekFallbackStateForTest(): void {
  if (seekFallbackRetryTimer) clearTimeout(seekFallbackRetryTimer);
  seekFallbackRetryTimer = null;
  seekFallbackRetryStartedAt = 0;
  seekFallbackRetryTarget = null;
  seekFallbackVisualTarget = null;
  _resetSeekRequestStateForTest();
}
