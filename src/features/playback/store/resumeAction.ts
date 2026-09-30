import { getSong } from '@/lib/api/subsonicLibrary';
import { enrichTrackPlaybackMetadata } from '@/features/playback/utils/audio/enrichTrackReplayGainMetadata';
import { invoke } from '@tauri-apps/api/core';
import { audioResume } from '@/lib/api/audio';
import { estimateLivePosition, orbitSnapshot } from '@/store/orbitRuntime';
import { setDeferHotCachePrefetch } from '@/lib/cache/hotCacheGate';
import {
  playbackCacheKeyForTrack,
  getPlaybackCacheServerKey,
  playbackProfileIdForTrack,
} from '@/features/playback/utils/playback/playbackServer';
import { findQueueItemRefForTrack } from '@/features/playback/utils/playback/queueIdentity';
import {
  localPlaybackOriginalVerifiedForUrl,
  resolvePlaybackUrlForTrack,
} from '@/features/playback/utils/playback/resolvePlaybackUrl';
import { resolveReplayGainDb } from '@/features/playback/utils/audio/resolveReplayGainDb';
import { audioPlayHiResBlendArgs } from '@/lib/audio/hiResCrossfadeResample';
import { songToTrack } from '@/lib/media/songToTrack';
import { useAuthStore } from '@/store/authStore';
import {
  bumpPlayGeneration,
  getIsAudioPaused,
  getPlayGeneration,
  setIsAudioPaused,
} from '@/features/playback/store/engineState';
import { touchHotCacheOnPlayback } from '@/features/playback/store/hotCacheTouch';
import {
  isReplayGainActive,
  loudnessGainDbForEngineBind,
} from '@/features/playback/store/loudnessGainCache';
import { analysisTrackRef } from '@/features/playback/store/analysisTrackRef';
import {
  playbackSourceHintForResolvedUrl,
  recordEnginePlayUrl,
} from '@/features/playback/store/playbackUrlRouting';
import type { PlayerState } from '@/features/playback/store/playerStoreTypes';
import { resolveQueueTrack } from '@/features/playback/store/queueTrackView';
import { promoteCompletedStreamToHotCache } from '@/features/playback/store/promoteStreamCache';
import { pushQueueOnPlaybackStart, flushLocalQueueWhenTakingPlayback } from '@/features/playback/store/queueSync';
import { markPlaybackActive } from '@/features/playback/store/queuePlaybackIdle';
import {
  playbackReportPlaying,
  playbackReportStart,
} from '@/features/playback/store/playbackReportSession';
import { resumeRadio } from '@/features/playback/store/radioPlayer';
import { clearAllPlaybackScheduleTimers } from '@/features/playback/store/scheduleTimers';
import { sanitizePauseResumeFadeSecs } from '@/lib/audio/pauseResumeFade';
import { ensureScrobblePlay } from '@/features/playback/store/scrobblePlaySession';
import { beginColdResumeRequest, coldResumePlayback, isColdResumePending } from '@/features/playback/store/coldResumePlayback';

type SetState = (
  partial: Partial<PlayerState> | ((state: PlayerState) => Partial<PlayerState>),
) => void;
type GetState = () => PlayerState;

/**
 * Resume playback from a paused state. Three mutually-exclusive
 * branches:
 *
 * 1. **Orbit guest** — catches the local player up to the host's live
 *    position. The user hit pause at some earlier point; resuming
 *    shouldn't drop them back at a stale local position while the
 *    host is already two songs ahead. Same-track → seek + un-pause;
 *    different-track → `playTrack` with a deferred seek.
 *
 * 2. **Radio** — HTML5 audio resume; no Rust engine involved.
 *
 * 3. **Regular track** — two sub-branches keyed off `getIsAudioPaused`:
 *    - **Warm**: engine still has the stream loaded but paused;
 *      `audio_resume` is enough.
 *    - **Cold**: engine has no loaded stream (app relaunch, or track
 *      ended and user hit play again). Promote any
 *      `stream_completed_cache` to hot disk, prefetch ReplayGain metadata
 *      (index → getSong), load and position a fresh player on pause, then
 *      unpause only if the Play request is still current. One reload is allowed.
 */
export function runResume(set: SetState, get: GetState): void {
  clearAllPlaybackScheduleTimers();
  markPlaybackActive();
  set({ scheduledPauseAtMs: null, scheduledPauseStartMs: null, scheduledResumeAtMs: null, scheduledResumeStartMs: null });

  // Orbit guest: resume means "catch up to the host's live stream".
  // The user hit pause at some earlier point; resuming shouldn't drop
  // them back at the stale local position while the host is already
  // two songs ahead. Covers PlayerBar, media keys, MPRIS — everything
  // that funnels through resume().
  const orbit = orbitSnapshot();
  const auth = useAuthStore.getState();
  const fadeSecs = auth.pauseResumeFadeEnabled
    ? sanitizePauseResumeFadeSecs(auth.pauseResumeFadeSecs)
    : null;
  const hostState = orbit.state;
  if (orbit.role === 'guest' && hostState?.isPlaying && hostState.currentTrack) {
    const trackId = hostState.currentTrack.trackId;
    const targetMs = estimateLivePosition(hostState, Date.now());
    const targetSec = Math.max(0, targetMs / 1000);
    const localTrackId = get().currentTrack?.id;
    void (async () => {
      try {
        const song = await getSong(trackId);
        if (!song) return;
        const track = songToTrack(song);
        const fraction = Math.max(0, Math.min(0.99, targetSec / Math.max(1, track.duration)));
        if (localTrackId === trackId) {
          // Same track: seek + un-pause via the Rust engine directly.
          // Bypasses this resume() branch re-entry via the early return below.
          get().seek(fraction);
          if (getIsAudioPaused()) {
            audioResume({ fadeSecs }).catch(console.error);
            setIsAudioPaused(false);
            set({ isPlaying: true });
            playbackReportPlaying(targetSec);
          } else {
            set({ isPlaying: true });
            playbackReportPlaying(targetSec);
          }
        } else {
          // Host has a different track — load it (`_orbitConfirmed=true`
          // skips the bulk gate; single-track play isn't a bulk replace
          // anyway). Seek after a short defer once the engine loads.
          get().playTrack(track, [track], false, true);
          window.setTimeout(() => {
            if (get().currentTrack?.id === trackId) get().seek(fraction);
          }, 400);
        }
      } catch { /* silent */ }
    })();
    return;
  }

  if (get().currentRadio) {
    resumeRadio(fadeSecs ?? 0).catch(console.error);
    set({ isPlaying: true });
    return;
  }
  const { currentTrack, queueItems, queueIndex, currentTime } = get();
  if (!currentTrack) return;

  if (getIsAudioPaused() && !isColdResumePending()) {
    // Rust engine has audio loaded but paused — just resume it.
    const warmGen = bumpPlayGeneration();
    const warmRef = findQueueItemRefForTrack(queueItems, currentTrack, queueIndex);
    ensureScrobblePlay(
      currentTrack.id,
      playbackProfileIdForTrack(currentTrack, warmRef),
    );
    audioResume({ fadeSecs }).catch((error: unknown) => {
      if (getPlayGeneration() !== warmGen || !get().isPlaying) return;
      if (String(error).includes('audio sink not ready')) {
        // The release event may have been missed: the backend, not the JS warm
        // flag, decides whether a player still exists. Recover through staging.
        setIsAudioPaused(false);
        runResume(set, get);
      } else {
        console.error('[psysonic] warm resume failed:', error);
        set({ isPlaying: false });
      }
    });
    setIsAudioPaused(false);
    set({ isPlaying: true });
    // Mirror pause(): tell the server immediately, don't wait for `audio:playing`.
    playbackReportPlaying(currentTime);
    void flushLocalQueueWhenTakingPlayback();
    touchHotCacheOnPlayback(currentTrack.id, getPlaybackCacheServerKey());
  } else {
    // Engine has no loaded paused stream (app relaunch, or track ended and user
    // hits play — `isAudioPaused` is false after `audio:ended`). Flush any
    // `stream_completed_cache` from the prior play to hot disk before resolving URL.
    const gen = bumpPlayGeneration();
    const finishColdResume = beginColdResumeRequest();
    const coldRef = findQueueItemRefForTrack(queueItems, currentTrack, queueIndex);
    const coldQueueIndex = coldRef ? queueItems.indexOf(coldRef) : queueIndex;
    const coldIndexKey = playbackCacheKeyForTrack(currentTrack, coldRef);
    const coldProfileId = playbackProfileIdForTrack(currentTrack, coldRef);
    // ReplayGain album-mode neighbours (resolver cache → placeholder; only their
    // RG tags matter, which a placeholder lacks → fallback dB).
    const coldPrev = coldQueueIndex > 0 && queueItems[coldQueueIndex - 1]
      ? resolveQueueTrack(queueItems[coldQueueIndex - 1]) : null;
    const coldNext = coldQueueIndex + 1 < queueItems.length && queueItems[coldQueueIndex + 1]
      ? resolveQueueTrack(queueItems[coldQueueIndex + 1]) : null;
    set({
      isPlaying: true,
      ...(currentTime <= 0 ? { scrobbled: false } : {}),
    });
    playbackReportStart(currentTrack.id, coldProfileId);

    void (async () => {
      const isCurrent = () => getPlayGeneration() === gen && get().isPlaying;
      try {
        const authHot = useAuthStore.getState();
        const resumePromoteSid = coldIndexKey;
        if (authHot.hotCacheEnabled && resumePromoteSid) {
          await promoteCompletedStreamToHotCache(
            currentTrack,
            resumePromoteSid,
            authHot.hotCacheDownloadDir || null,
          );
        }
        if (!isCurrent()) return;

        let trackToPlay = currentTrack;
        try {
          if (coldIndexKey) {
            trackToPlay = await enrichTrackPlaybackMetadata(currentTrack, coldIndexKey);
          }
        } catch { /* keep currentTrack */ }
        if (!isCurrent()) return;
        if (trackToPlay !== currentTrack) set({ currentTrack: trackToPlay });

        const authStateCold = useAuthStore.getState();
        const replayGainDbCold = resolveReplayGainDb(
          trackToPlay, coldPrev, coldNext,
          isReplayGainActive(), authStateCold.replayGainMode,
        );
        const replayGainPeakCold = isReplayGainActive() ? (trackToPlay.replayGainPeak ?? null) : null;
        setDeferHotCachePrefetch(true);
        const coldUrl = resolvePlaybackUrlForTrack(trackToPlay, coldIndexKey);
        set({ currentPlaybackSource: playbackSourceHintForResolvedUrl(trackToPlay.id, coldIndexKey, coldUrl) });
        recordEnginePlayUrl(trackToPlay.id, coldUrl);
        touchHotCacheOnPlayback(trackToPlay.id, coldIndexKey);
        const lastPosition = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
        const resumeAt = Number.isFinite(trackToPlay.duration) && trackToPlay.duration > 0
          ? Math.min(lastPosition, Math.max(0, trackToPlay.duration - 0.25))
          : lastPosition;
        await coldResumePlayback({
          isCurrent,
          resume: () => audioResume({ fadeSecs, notifyPlaying: true }),
          loadPaused: () => invoke('audio_play', {
            url: coldUrl,
            volume: get().volume,
            durationHint: trackToPlay.duration,
            replayGainDb: replayGainDbCold,
            replayGainPeak: replayGainPeakCold,
            loudnessGainDb: loudnessGainDbForEngineBind(analysisTrackRef(trackToPlay.id, coldIndexKey)),
            preGainDb: authStateCold.replayGainPreGainDb,
            fallbackDb: authStateCold.replayGainFallbackDb,
            manual: true,
            ...audioPlayHiResBlendArgs(useAuthStore.getState()),
            analysisTrackId: trackToPlay.id,
            serverId: coldIndexKey || null,
            localOriginalVerified: localPlaybackOriginalVerifiedForUrl(
              trackToPlay.id,
              coldIndexKey,
              coldUrl,
            ),
            streamFormatSuffix: trackToPlay.suffix ?? null,
            startPaused: true,
            startSecs: resumeAt,
            requireStartSeek: true,
          }),
        });
        if (!isCurrent()) return;
        setIsAudioPaused(false);
        setDeferHotCachePrefetch(false);
        pushQueueOnPlaybackStart(queueItems, trackToPlay, resumeAt);
      } catch (err: unknown) {
        if (!isCurrent()) return;
        setDeferHotCachePrefetch(false);
        console.error('[psysonic] audio_play (cold resume) failed:', err);
        set({ isPlaying: false });
      } finally {
        finishColdResume();
      }
    })();
  }
}
