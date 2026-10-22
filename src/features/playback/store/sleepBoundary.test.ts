import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTrack, seedQueue } from '@/test/helpers/factories';
import { resetAllStores } from '@/test/helpers/storeReset';
import { useAuthStore } from '@/store/authStore';
import type { Track } from '@/lib/media/trackTypes';
import { usePlayerStore } from './playerStore';
import { emitPlaybackProgress } from './playbackProgress';
import { _resetScheduleTimersForTest } from './scheduleTimers';
import {
  consumeSleepBoundaryAtTrackEnd,
  handleSleepBoundaryProgress,
  pauseAtSleepBoundaryInsteadOfAdvance,
  scheduleSleepBoundaryPause,
  sleepBoundaryEndsWithCurrentTrack,
  sleepBoundaryLeadSec,
  sleepBoundaryRemainingTrackSec,
} from './sleepBoundary';

const pause = vi.fn();

/** Two tracks of album A, then one of album B, each 100 s long. */
function albumQueue(): Track[] {
  return [
    makeTrack({ albumId: 'album-a', duration: 100 }),
    makeTrack({ albumId: 'album-a', duration: 100 }),
    makeTrack({ albumId: 'album-b', duration: 100 }),
  ];
}

function playAt(tracks: Track[], index: number): void {
  seedQueue(tracks, { index, serverId: 'srv' });
  usePlayerStore.setState({ isPlaying: true, pause });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetAllStores();
  _resetScheduleTimersForTest();
  pause.mockClear();
  useAuthStore.setState({
    pauseResumeFadeEnabled: false,
    crossfadeEnabled: false,
    gaplessEnabled: false,
  });
});

afterEach(() => {
  _resetScheduleTimersForTest();
  vi.useRealTimers();
});

describe('sleepBoundaryEndsWithCurrentTrack', () => {
  it('always ends with the current track in track mode', () => {
    playAt(albumQueue(), 0);
    expect(sleepBoundaryEndsWithCurrentTrack('track', usePlayerStore.getState())).toBe(true);
  });

  it('ends an album only where the next track belongs to another album', () => {
    const tracks = albumQueue();
    playAt(tracks, 0);
    expect(sleepBoundaryEndsWithCurrentTrack('album', usePlayerStore.getState())).toBe(false);
    playAt(tracks, 1);
    expect(sleepBoundaryEndsWithCurrentTrack('album', usePlayerStore.getState())).toBe(true);
  });

  it('ends the album at the end of the queue, but not while repeat-one replays the track', () => {
    const tracks = albumQueue();
    playAt(tracks, 2);
    expect(sleepBoundaryEndsWithCurrentTrack('album', usePlayerStore.getState())).toBe(true);
    usePlayerStore.setState({ repeatMode: 'one' });
    expect(sleepBoundaryEndsWithCurrentTrack('album', usePlayerStore.getState())).toBe(false);
  });
});

describe('sleepBoundaryLeadSec', () => {
  it('leaves room for the pause fade and the engine crossfade', () => {
    const base = { pauseResumeFadeEnabled: false, pauseResumeFadeSecs: 1, crossfadeEnabled: false, crossfadeSecs: 4, gaplessEnabled: false };
    expect(sleepBoundaryLeadSec(base)).toBeCloseTo(0.5);
    expect(sleepBoundaryLeadSec({ ...base, pauseResumeFadeEnabled: true })).toBeCloseTo(1.5);
    expect(sleepBoundaryLeadSec({ ...base, crossfadeEnabled: true })).toBeCloseTo(4.5);
    // Gapless takes over from crossfade, so no crossfade time is reserved.
    expect(sleepBoundaryLeadSec({ ...base, crossfadeEnabled: true, gaplessEnabled: true })).toBeCloseTo(0.5);
  });
});

describe('sleepBoundaryRemainingTrackSec', () => {
  it('counts the rest of the track, plus the rest of the album in album mode', () => {
    playAt(albumQueue(), 0);
    const state = usePlayerStore.getState();
    expect(sleepBoundaryRemainingTrackSec('track', state, 40, 100)).toBe(60);
    expect(sleepBoundaryRemainingTrackSec('album', state, 40, 100)).toBe(160);
  });
});

describe('handleSleepBoundaryProgress', () => {
  it('pauses just before the end of the track and not earlier', () => {
    playAt(albumQueue(), 0);
    usePlayerStore.setState({ scheduledPauseBoundary: 'track' });

    expect(handleSleepBoundaryProgress(50, 100)).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(pause).not.toHaveBeenCalled();

    // Pause point is 99.5 s; at 98 s it is 1.5 s away.
    expect(handleSleepBoundaryProgress(98, 100)).toBe(false);
    vi.advanceTimersByTime(1_400);
    expect(pause).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('lets an album play through and pauses at its last track', () => {
    const tracks = albumQueue();
    playAt(tracks, 0);
    usePlayerStore.setState({ scheduledPauseBoundary: 'album' });
    expect(handleSleepBoundaryProgress(99.9, 100)).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(pause).not.toHaveBeenCalled();

    usePlayerStore.setState({ queueIndex: 1, currentTrack: tracks[1] });
    expect(handleSleepBoundaryProgress(99.9, 100)).toBe(true);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('does not pause a different track when the armed one was left in the meantime', () => {
    const tracks = albumQueue();
    playAt(tracks, 0);
    usePlayerStore.setState({ scheduledPauseBoundary: 'track' });
    handleSleepBoundaryProgress(98, 100);

    usePlayerStore.setState({ queueIndex: 1, currentTrack: tracks[1] });
    vi.advanceTimersByTime(3_000);
    expect(pause).not.toHaveBeenCalled();
  });

  it('keeps the countdown estimate in line with the boundary', () => {
    vi.setSystemTime(1_000_000);
    playAt(albumQueue(), 0);
    usePlayerStore.setState({ scheduledPauseBoundary: 'album' });
    handleSleepBoundaryProgress(40, 100);
    // 60 s of this track + 100 s of the next, minus the 0.5 s lead.
    expect(usePlayerStore.getState().scheduledPauseAtMs).toBe(1_000_000 + 159_500);
  });

  it('does nothing without a boundary, while paused, or for radio', () => {
    playAt(albumQueue(), 0);
    expect(handleSleepBoundaryProgress(99.9, 100)).toBe(false);
    usePlayerStore.setState({ scheduledPauseBoundary: 'track', isPlaying: false });
    expect(handleSleepBoundaryProgress(99.9, 100)).toBe(false);
    usePlayerStore.setState({ isPlaying: true, currentRadio: { id: 'r', name: 'r', streamUrl: 'http://x' } as never });
    expect(handleSleepBoundaryProgress(99.9, 100)).toBe(false);
    expect(pause).not.toHaveBeenCalled();
  });
});

describe('scheduleSleepBoundaryPause', () => {
  it('replaces a clock timer and shows an estimate right away', () => {
    vi.setSystemTime(2_000_000);
    playAt(albumQueue(), 0);
    usePlayerStore.getState().schedulePauseIn(1800);
    emitPlaybackProgress({ currentTime: 30, progress: 0.3, buffered: 0, buffering: false });

    scheduleSleepBoundaryPause('track');
    const state = usePlayerStore.getState();
    expect(state.scheduledPauseBoundary).toBe('track');
    expect(state.scheduledPauseAtMs).toBe(2_000_000 + 69_500);

    // The 30-minute clock timer is gone.
    vi.advanceTimersByTime(1800 * 1000);
    expect(pause).not.toHaveBeenCalled();
  });

  it('is cleared by cancelling, and replaced by a clock timer', () => {
    playAt(albumQueue(), 0);
    scheduleSleepBoundaryPause('album');
    usePlayerStore.getState().clearScheduledPause();
    expect(usePlayerStore.getState().scheduledPauseBoundary).toBeNull();

    scheduleSleepBoundaryPause('album');
    usePlayerStore.getState().schedulePauseIn(600);
    expect(usePlayerStore.getState().scheduledPauseBoundary).toBeNull();
  });
});

describe('boundary fallbacks', () => {
  it('pauses at a frontend-driven transition point that comes first', () => {
    playAt(albumQueue(), 1);
    usePlayerStore.setState({ scheduledPauseBoundary: 'album' });
    expect(pauseAtSleepBoundaryInsteadOfAdvance()).toBe(true);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('does not pause at a transition inside the album', () => {
    playAt(albumQueue(), 0);
    usePlayerStore.setState({ scheduledPauseBoundary: 'album' });
    expect(pauseAtSleepBoundaryInsteadOfAdvance()).toBe(false);
    expect(pause).not.toHaveBeenCalled();
  });

  it('spends the timer when the boundary track ran out before the pause landed', () => {
    playAt(albumQueue(), 0);
    usePlayerStore.setState({ scheduledPauseBoundary: 'track', scheduledPauseAtMs: 1, scheduledPauseStartMs: 0 });
    expect(consumeSleepBoundaryAtTrackEnd(usePlayerStore.getState())).toBe(true);
    const state = usePlayerStore.getState();
    expect(state.scheduledPauseBoundary).toBeNull();
    expect(state.scheduledPauseAtMs).toBeNull();
  });
});
