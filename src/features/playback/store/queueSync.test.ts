import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueItemRef, Track } from '@/lib/media/trackTypes';

const { savePlayQueueMock, playerState, progressSnapshot, isSubsonicServerReachableMock } = vi.hoisted(() => ({
  savePlayQueueMock: vi.fn(async (
    _ids?: string[],
    _current?: string,
    _position?: number,
    _serverId?: string,
  ) => undefined),
  isSubsonicServerReachableMock: vi.fn((_serverId: string) => true),
  playerState: {
    queueItems: [] as QueueItemRef[],
    currentTrack: null as Track | null,
    currentRadio: null as { id: string } | null,
  },
  progressSnapshot: { currentTime: 0, progress: 0, buffered: 0 },
}));

vi.mock('@/lib/api/subsonicPlayQueue', () => ({ savePlayQueue: savePlayQueueMock }));
vi.mock('@/lib/network/subsonicNetworkGuard', () => ({
  isSubsonicServerReachable: (serverId: string) => isSubsonicServerReachableMock(serverId),
}));
vi.mock('@/features/playback/utils/playback/playbackServer', () => ({
  getPlaybackServerId: () => 'srv-a',
  playbackProfileIdForTrack: (track: Track) => track.serverId ?? 'srv-a',
  filterQueueRefsForPlaybackServer: (refs: QueueItemRef[]) =>
    refs.filter(r => r.serverId === 'a.test' || r.serverId === 'srv-a'),
}));
vi.mock('@/features/playback/utils/playback/trackServerScope', () => ({
  filterQueueRefsForServerProfile: (refs: QueueItemRef[], profileId: string) =>
    refs.filter(r => r.serverId === profileId
      || (profileId === 'srv-a' && r.serverId === 'a.test')
      || (profileId === 'srv-b' && r.serverId === 'b.test')),
}));
vi.mock('@/lib/media/trackServerScope', () => ({
  profileIdFromQueueRef: (queueRef: QueueItemRef) =>
    queueRef.serverId === 'a.test' ? 'srv-a' : queueRef.serverId === 'b.test' ? 'srv-b' : queueRef.serverId,
}));
vi.mock('@/features/playback/store/playerStore', () => ({
  usePlayerStore: { getState: () => playerState },
}));
vi.mock('@/features/playback/store/playbackProgress', () => ({
  getPlaybackProgressSnapshot: () => progressSnapshot,
}));

import {
  _resetQueueSyncForTest,
  finalizePlayQueueAtTrackEnd,
  flushPlayQueueForServer,
  flushPlayQueuePosition,
  flushQueueSyncToServer,
  getLastQueueHeartbeatAt,
  hasPendingQueueSync,
  pushQueueOnPlaybackStart,
  syncQueueToServer,
  syncAutomaticQueueMutationToServers,
  syncUserQueueClearToServers,
  syncUserQueueMutationToServer,
} from '@/features/playback/store/queueSync';
import {
  _resetQueuePlaybackIdleForTest,
  isIdleQueuePullSuspended,
  isQueuePushFailed,
  isQueueNaturallyEnded,
} from '@/features/playback/store/queuePlaybackIdle';
import { usePlayQueueSyncSettingsStore } from '@/features/playback/store/playQueueSyncSettingsStore';

function track(id: string, serverId = 'srv-a'): Track {
  return { id, title: id, artist: 'A', album: 'X', albumId: 'X', duration: 100, serverId };
}

function ref(id: string, serverId = 'a.test'): QueueItemRef {
  return { serverId, trackId: id };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-12T12:00:00Z'));
  isSubsonicServerReachableMock.mockReturnValue(true);
  savePlayQueueMock.mockClear();
  savePlayQueueMock.mockResolvedValue(undefined);
  playerState.queueItems = [];
  playerState.currentTrack = null;
  playerState.currentRadio = null;
  progressSnapshot.currentTime = 0;
  _resetQueuePlaybackIdleForTest();
  usePlayQueueSyncSettingsStore.setState({ enabled: true });
});

afterEach(() => {
  _resetQueueSyncForTest();
  vi.useRealTimers();
});

describe('syncQueueToServer (debounced)', () => {
  const queue = [ref('a'), ref('b')];

  it('skips sync while the playback server is unreachable', () => {
    isSubsonicServerReachableMock.mockReturnValue(false);
    syncQueueToServer(queue, track('a'), 30);
    vi.advanceTimersByTime(5000);
    expect(savePlayQueueMock).not.toHaveBeenCalled();
  });

  it('does not schedule or push when queue sync is disabled for this device', () => {
    usePlayQueueSyncSettingsStore.setState({ enabled: false });
    syncQueueToServer(queue, track('a'), 30);
    vi.advanceTimersByTime(5000);
    expect(hasPendingQueueSync()).toBe(false);
    expect(savePlayQueueMock).not.toHaveBeenCalled();
  });

  it('cancels a pending push when queue sync is disabled', () => {
    syncQueueToServer(queue, track('a'), 30);
    expect(hasPendingQueueSync()).toBe(true);

    usePlayQueueSyncSettingsStore.getState().setEnabled(false);
    vi.advanceTimersByTime(5000);

    expect(hasPendingQueueSync()).toBe(false);
    expect(savePlayQueueMock).not.toHaveBeenCalled();
  });

  it('fires once after 5 s with id list + current id + position in ms', () => {
    syncQueueToServer(queue, track('a'), 30);
    vi.advanceTimersByTime(5000);
    expect(savePlayQueueMock).toHaveBeenCalledWith(['a', 'b'], 'a', 30000, 'srv-a');
  });

  it('sends only refs owned by the playback server in a mixed queue', () => {
    const mixed = [ref('a', 'a.test'), ref('b', 'b.test')];
    syncQueueToServer(mixed, track('a', 'srv-a'), 12);
    vi.advanceTimersByTime(5000);
    expect(savePlayQueueMock).toHaveBeenCalledWith(['a'], 'a', 12000, 'srv-a');
  });

  it('does not suspend idle pull during playback sync', () => {
    syncQueueToServer(queue, track('a'), 30);
    expect(isIdleQueuePullSuspended()).toBe(false);
  });
});

describe('syncUserQueueMutationToServer (debounced)', () => {
  const queue = [ref('a'), ref('b')];

  it('suspends idle pull on user mutation and stays suspended after successful debounced push', async () => {
    syncUserQueueMutationToServer([], queue, track('a'), 30);
    expect(isIdleQueuePullSuspended()).toBe(true);
    expect(hasPendingQueueSync()).toBe(true);
    vi.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(savePlayQueueMock).toHaveBeenCalled();
    expect(isIdleQueuePullSuspended()).toBe(true);
  });

  it('keeps local queue edits local when queue sync is disabled', () => {
    usePlayQueueSyncSettingsStore.setState({ enabled: false });
    syncUserQueueMutationToServer([], queue, track('a'), 30);
    expect(isIdleQueuePullSuspended()).toBe(false);
    expect(hasPendingQueueSync()).toBe(false);
  });

  it('keeps idle pull suspended and flags the failed push when debounced push fails', async () => {
    savePlayQueueMock.mockRejectedValueOnce(new Error('offline'));
    syncUserQueueMutationToServer([], queue, track('a'), 30);
    vi.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(isIdleQueuePullSuspended()).toBe(true);
    expect(isQueuePushFailed()).toBe(true);
  });

  it('schedules independent server projections for a mixed queue', async () => {
    const mixed = [ref('a1', 'a.test'), ref('b1', 'b.test'), ref('a2', 'a.test')];
    syncUserQueueMutationToServer([], mixed, track('a1', 'srv-a'), 12);

    expect(hasPendingQueueSync()).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);

    expect(savePlayQueueMock).toHaveBeenCalledTimes(2);
    expect(savePlayQueueMock).toHaveBeenCalledWith(['a1', 'a2'], 'a1', 12000, 'srv-a');
    expect(savePlayQueueMock).toHaveBeenCalledWith(['b1'], 'b1', 0, 'srv-b');
    expect(hasPendingQueueSync()).toBe(false);
  });

  it('cancels a disappeared owner projection and schedules a remote clear', async () => {
    const mixed = [ref('a1', 'a.test'), ref('b1', 'b.test')];
    syncUserQueueMutationToServer(
      [],
      mixed,
      track('a1', 'srv-a'),
      4,
    );
    vi.advanceTimersByTime(1000);
    syncUserQueueMutationToServer(mixed, [ref('a2', 'a.test')], track('a2', 'srv-a'), 8);

    await vi.advanceTimersByTimeAsync(4000);
    expect(savePlayQueueMock).not.toHaveBeenCalledWith(['b1'], 'b1', 0, 'srv-b');
    expect(savePlayQueueMock).not.toHaveBeenCalledWith(['a1'], 'a1', 4000, 'srv-a');

    await vi.advanceTimersByTimeAsync(1000);
    expect(savePlayQueueMock).toHaveBeenCalledWith([], undefined, undefined, 'srv-b');
    expect(savePlayQueueMock).toHaveBeenCalledWith(['a2'], 'a2', 8000, 'srv-a');
  });

  it('a failed server projection does not mark another server as failed', async () => {
    savePlayQueueMock.mockImplementation(async (_ids, _current, _position, serverId) => {
      if (serverId === 'srv-b') throw new Error('offline');
    });
    syncUserQueueMutationToServer(
      [],
      [ref('a1', 'a.test'), ref('b1', 'b.test')],
      track('a1', 'srv-a'),
      4,
    );

    await vi.advanceTimersByTimeAsync(5000);
    expect(isQueuePushFailed('srv-a')).toBe(false);
    expect(isQueuePushFailed('srv-b')).toBe(true);
  });
});

describe('syncAutomaticQueueMutationToServers', () => {
  it('syncs every affected owner without suspending idle pull', async () => {
    syncAutomaticQueueMutationToServers(
      [ref('a1', 'a.test')],
      [ref('b1', 'b.test')],
      track('b1', 'srv-b'),
      7,
    );

    expect(isIdleQueuePullSuspended()).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(savePlayQueueMock).toHaveBeenCalledWith([], undefined, undefined, 'srv-a');
    expect(savePlayQueueMock).toHaveBeenCalledWith(['b1'], 'b1', 7000, 'srv-b');
  });
});

describe('syncUserQueueClearToServers', () => {
  it('clears every remote server queue represented by the previous mixed queue', async () => {
    syncUserQueueClearToServers([
      ref('a1', 'a.test'),
      ref('b1', 'b.test'),
      ref('a2', 'a.test'),
    ]);

    await vi.advanceTimersByTimeAsync(5000);
    expect(savePlayQueueMock).toHaveBeenCalledTimes(2);
    expect(savePlayQueueMock).toHaveBeenCalledWith([], undefined, undefined, 'srv-a');
    expect(savePlayQueueMock).toHaveBeenCalledWith([], undefined, undefined, 'srv-b');
  });
});

describe('pushQueueOnPlaybackStart', () => {
  const queue = [ref('a'), ref('b')];

  it('flushes immediately and clears idle pull suspension when locally edited', async () => {
    syncUserQueueMutationToServer([], queue, track('a'), 30);
    expect(hasPendingQueueSync()).toBe(true);
    pushQueueOnPlaybackStart(queue, track('a'), 42);
    expect(hasPendingQueueSync()).toBe(false);
    await vi.runAllTimersAsync();
    expect(savePlayQueueMock).toHaveBeenCalledWith(['a', 'b'], 'a', 42000, 'srv-a');
    expect(isIdleQueuePullSuspended()).toBe(false);
  });

  it('keeps idle pull suspended when the immediate flush fails', async () => {
    syncUserQueueMutationToServer([], queue, track('a'), 30);
    savePlayQueueMock.mockRejectedValueOnce(new Error('414'));
    pushQueueOnPlaybackStart(queue, track('a'), 42);
    await vi.runAllTimersAsync();
    expect(savePlayQueueMock).toHaveBeenCalled();
    expect(isIdleQueuePullSuspended()).toBe(true);
    expect(isQueuePushFailed()).toBe(true);
  });

  it('debounces when idle pull is not suspended', () => {
    pushQueueOnPlaybackStart(queue, track('a'), 12);
    expect(hasPendingQueueSync()).toBe(true);
    expect(savePlayQueueMock).not.toHaveBeenCalled();
  });
});

describe('flushQueueSyncToServer failure', () => {
  it('reports unreachable as failure and blocks stale idle pull', async () => {
    isSubsonicServerReachableMock.mockReturnValue(false);
    const ok = await flushQueueSyncToServer([ref('a')], track('a'), 12);
    expect(ok).toBe(false);
    expect(savePlayQueueMock).not.toHaveBeenCalled();
    expect(isQueuePushFailed()).toBe(true);
  });

  it('flags the failed push (blocking idle pull) without lighting the handoff LED', async () => {
    savePlayQueueMock.mockRejectedValueOnce(new Error('offline'));
    const ok = await flushQueueSyncToServer([ref('a')], track('a'), 12);
    expect(ok).toBe(false);
    // Blocks idle auto-pull (safety) but is a separate, transient flag — a bare
    // push failure must not drive the user-edit handoff suspension / yellow LED.
    expect(isQueuePushFailed()).toBe(true);
    expect(isIdleQueuePullSuspended()).toBe(false);
  });

  it('self-heals: a later successful push clears the failed-push flag', async () => {
    savePlayQueueMock.mockRejectedValueOnce(new Error('offline'));
    await flushQueueSyncToServer([ref('a')], track('a'), 12);
    expect(isQueuePushFailed()).toBe(true);

    const ok = await flushQueueSyncToServer([ref('a')], track('a'), 20);
    expect(ok).toBe(true);
    expect(isQueuePushFailed()).toBe(false);
    expect(isIdleQueuePullSuspended()).toBe(false);
  });

  it('debounced playback push failure flags without suspending, then self-heals', async () => {
    savePlayQueueMock.mockRejectedValueOnce(new Error('offline'));
    syncQueueToServer([ref('a')], track('a'), 12);
    vi.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(isQueuePushFailed()).toBe(true);
    expect(isIdleQueuePullSuspended()).toBe(false);

    const ok = await flushQueueSyncToServer([ref('a')], track('a'), 20);
    expect(ok).toBe(true);
    expect(isQueuePushFailed()).toBe(false);
  });
});

describe('flushPlayQueueForServer', () => {
  it('flushes only the target server slice', async () => {
    playerState.queueItems = [ref('a', 'srv-a'), ref('b', 'b.test')];
    playerState.currentTrack = track('a', 'srv-a');
    progressSnapshot.currentTime = 9;
    await flushPlayQueueForServer('srv-a');
    expect(savePlayQueueMock).toHaveBeenCalledWith(['a'], 'a', 9000, 'srv-a');
  });

  it('saves an inactive server slice with its first item at position zero', async () => {
    playerState.queueItems = [ref('a', 'a.test'), ref('b', 'b.test')];
    playerState.currentTrack = track('a', 'srv-a');
    progressSnapshot.currentTime = 9;
    await flushPlayQueueForServer('srv-b');
    expect(savePlayQueueMock).toHaveBeenCalledWith(['b'], 'b', 0, 'srv-b');
  });
});

describe('flushQueueSyncToServer (immediate)', () => {
  it('fires synchronously with no debounce', async () => {
    await flushQueueSyncToServer([ref('a')], track('a'), 12);
    expect(savePlayQueueMock).toHaveBeenCalledWith(['a'], 'a', 12000, 'srv-a');
  });

  it('records the heartbeat timestamp', async () => {
    expect(getLastQueueHeartbeatAt()).toBe(0);
    await flushQueueSyncToServer([ref('a')], track('a'), 5);
    expect(getLastQueueHeartbeatAt()).toBe(Date.now());
  });
});

describe('flushPlayQueuePosition', () => {
  it('reads the current playerStore queue + playback-progress time', async () => {
    playerState.queueItems = [ref('a'), ref('b')];
    playerState.currentTrack = track('a');
    progressSnapshot.currentTime = 42;
    await flushPlayQueuePosition();
    expect(savePlayQueueMock).toHaveBeenCalledWith(['a', 'b'], 'a', 42000, 'srv-a');
  });

  it('is a no-op when a radio session is active', async () => {
    playerState.queueItems = [ref('a')];
    playerState.currentTrack = track('a');
    playerState.currentRadio = { id: 'radio-1' };
    await flushPlayQueuePosition();
    expect(savePlayQueueMock).not.toHaveBeenCalled();
  });
});

describe('finalizePlayQueueAtTrackEnd', () => {
  it('flushes immediately at track duration and marks the queue naturally ended', async () => {
    const queue = [ref('a'), ref('b')];
    const current = track('b');
    current.duration = 245;
    syncQueueToServer(queue, current, 120);
    await finalizePlayQueueAtTrackEnd(queue, current);
    expect(savePlayQueueMock).toHaveBeenCalledTimes(1);
    expect(savePlayQueueMock).toHaveBeenCalledWith(['a', 'b'], 'b', 245000, 'srv-a');
    expect(isQueueNaturallyEnded()).toBe(true);
    expect(hasPendingQueueSync()).toBe(false);
  });
});
