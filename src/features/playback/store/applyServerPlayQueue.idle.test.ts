import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueItemRef } from '@/lib/media/trackTypes';
import { useAuthStore } from '@/store/authStore';

const getPlayQueueForServerMock = vi.fn();

vi.mock('@/lib/api/subsonicPlayQueue', () => ({
  getPlayQueueForServer: (...args: unknown[]) => getPlayQueueForServerMock(...args),
}));

vi.mock('@/lib/server/serverLookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/serverLookup')>();
  return {
    ...actual,
    resolveServerIdForIndexKey: (id: string) => id,
  };
});

vi.mock('@/lib/media/songToTrack', () => ({
  songToTrack: (s: { id: string }) => ({
    id: s.id,
    title: s.id,
    artist: '',
    album: '',
    albumId: '',
    duration: 60,
    serverId: 'srv-a',
  }),
}));

vi.mock('@/features/playback/store/pausedRestorePrepare', () => ({
  preparePausedRestoreOnStartup: vi.fn(),
}));

vi.mock('@/features/playback/store/waveformRefresh', () => ({
  refreshWaveformForTrack: vi.fn(),
}));

vi.mock('@/features/playback/store/queueSyncUiState', () => ({
  clearQueueHandoffPending: vi.fn(),
}));

const playerState = {
  queueServerId: null as string | null,
  queueItems: [] as QueueItemRef[],
  queueIndex: 0,
  currentTrack: null as { id: string; title: string; artist: string; album: string; albumId: string; duration: number } | null,
  currentTime: 0,
  isPlaying: false,
};

vi.mock('@/features/playback/store/playerStore', () => ({
  usePlayerStore: {
    getState: () => playerState,
    setState: (partial: Partial<typeof playerState>) => {
      Object.assign(playerState, partial);
    },
  },
}));

import {
  applyServerPlayQueue,
  pullPlayQueueFromActiveServer,
} from '@/features/playback/store/applyServerPlayQueue';
import {
  _resetQueuePlaybackIdleForTest,
  getIdlePullGeneration,
  isIdleQueuePullSuspended,
  markQueuePushFailed,
  touchQueueMutationClock,
} from '@/features/playback/store/queuePlaybackIdle';
import { usePlayQueueSyncSettingsStore } from '@/features/playback/store/playQueueSyncSettingsStore';

describe('applyServerPlayQueue idle guards', () => {
  beforeEach(() => {
    _resetQueuePlaybackIdleForTest();
    usePlayQueueSyncSettingsStore.setState({ enabled: true });
    getPlayQueueForServerMock.mockReset();
    playerState.queueServerId = null;
    playerState.queueItems = [{ serverId: 'srv-a', trackId: 'local-only' }];
    playerState.queueIndex = 0;
    playerState.currentTrack = {
      id: 'local-only',
      title: 'local-only',
      artist: '',
      album: '',
      albumId: '',
      duration: 60,
    };
    playerState.currentTime = 12;
    playerState.isPlaying = false;
  });

  it('does not apply server queue in idle mode while local edits suspend pull', async () => {
    getPlayQueueForServerMock.mockResolvedValue({
      songs: [{ id: 'remote-a' }, { id: 'remote-b' }],
      current: 'remote-a',
      position: 5000,
    });
    touchQueueMutationClock();

    const result = await applyServerPlayQueue('srv-a', { mode: 'idle' });

    expect(result).toBe('noop');
    expect(getPlayQueueForServerMock).not.toHaveBeenCalled();
    expect(playerState.queueItems).toEqual([{ serverId: 'srv-a', trackId: 'local-only' }]);
    expect(isIdleQueuePullSuspended()).toBe(true);
  });

  it('does not fetch or apply a server queue when sync is disabled for this device', async () => {
    usePlayQueueSyncSettingsStore.setState({ enabled: false });

    const result = await applyServerPlayQueue('srv-a', { mode: 'startup' });

    expect(result).toBe('noop');
    expect(getPlayQueueForServerMock).not.toHaveBeenCalled();
    expect(playerState.queueItems).toEqual([{ serverId: 'srv-a', trackId: 'local-only' }]);
  });

  it('does not apply server queue in idle mode while a failed push blocks pull', async () => {
    getPlayQueueForServerMock.mockResolvedValue({
      songs: [{ id: 'remote-a' }, { id: 'remote-b' }],
      current: 'remote-a',
      position: 5000,
    });
    markQueuePushFailed();

    const result = await applyServerPlayQueue('srv-a', { mode: 'idle' });

    expect(result).toBe('noop');
    expect(getPlayQueueForServerMock).not.toHaveBeenCalled();
    expect(playerState.queueItems).toEqual([{ serverId: 'srv-a', trackId: 'local-only' }]);
    // The failed-push guard blocks pull without implying a user-edit suspension.
    expect(isIdleQueuePullSuspended()).toBe(false);
  });

  it('ignores stale idle pull responses after a local mutation during fetch', async () => {
    const generationAtFetch = getIdlePullGeneration();
    getPlayQueueForServerMock.mockImplementation(async () => {
      touchQueueMutationClock();
      expect(getIdlePullGeneration()).toBe(generationAtFetch + 1);
      return {
        songs: [{ id: 'remote-a' }],
        current: 'remote-a',
        position: 0,
      };
    });

    const result = await applyServerPlayQueue('srv-a', { mode: 'idle' });

    expect(result).toBe('noop');
    expect(playerState.queueItems).toEqual([{ serverId: 'srv-a', trackId: 'local-only' }]);
  });

  it('does not overwrite an active Navidrome public share queue in idle mode', async () => {
    playerState.queueServerId = 'navidrome-public-share';
    playerState.queueItems = [{
      serverId: 'navidrome-public-share',
      trackId: 'ndshare:abc:0',
      directStreamUrl: 'https://music.example.com/share/s/jwt-a',
    }];
    getPlayQueueForServerMock.mockResolvedValue({
      songs: [{ id: 'remote-a' }],
      current: 'remote-a',
      position: 0,
    });

    const result = await applyServerPlayQueue('srv-a', { mode: 'idle' });

    expect(result).toBe('noop');
    expect(getPlayQueueForServerMock).not.toHaveBeenCalled();
    expect(playerState.queueItems[0]?.trackId).toBe('ndshare:abc:0');
  });

  it('refreshes only the selected server projection in a mixed queue', async () => {
    playerState.queueItems = [
      { serverId: 'srv-a', trackId: 'a1' },
      { serverId: 'srv-b', trackId: 'b1' },
      { serverId: 'srv-a', trackId: 'a2' },
    ];
    playerState.queueIndex = 1;
    playerState.currentTrack = {
      id: 'b1', title: 'b1', artist: '', album: '', albumId: '', duration: 60,
    };
    getPlayQueueForServerMock.mockResolvedValue({
      songs: [{ id: 'a1' }, { id: 'a3' }],
      current: 'a1',
      position: 0,
    });

    const result = await applyServerPlayQueue('srv-a', { mode: 'manual' });

    expect(result).toBe('applied');
    expect(getPlayQueueForServerMock).toHaveBeenCalledWith('srv-a');
    expect(playerState.queueItems.map(ref => ref.trackId)).toEqual(['a1', 'b1', 'a3']);
    expect(playerState.queueIndex).toBe(1);
  });

  it('updates the active-server projection in a mixed queue', async () => {
    useAuthStore.setState({ activeServerId: 'srv-a' });
    playerState.queueItems = [
      { serverId: 'srv-a', trackId: 'a1' },
      { serverId: 'srv-b', trackId: 'b1' },
      { serverId: 'srv-a', trackId: 'a2' },
    ];

    getPlayQueueForServerMock.mockResolvedValue({
      songs: [{ id: 'a1' }, { id: 'a3' }],
      current: 'a1',
      position: 0,
    });

    await expect(pullPlayQueueFromActiveServer()).resolves.toBe('applied');
    expect(getPlayQueueForServerMock).toHaveBeenCalledWith('srv-a');
    expect(playerState.queueItems.map(ref => ref.trackId)).toEqual(['a1', 'b1', 'a3']);
  });

  it('applies server queue on startup even when share refs are still in memory', async () => {
    playerState.queueServerId = 'navidrome-public-share';
    playerState.queueItems = [{
      serverId: 'navidrome-public-share',
      trackId: 'ndshare:abc:0',
      directStreamUrl: 'https://music.example.com/share/s/jwt-a',
    }];
    getPlayQueueForServerMock.mockResolvedValue({
      songs: [{ id: 'remote-a' }],
      current: 'remote-a',
      position: 0,
    });

    const result = await applyServerPlayQueue('srv-a', { mode: 'startup' });

    expect(result).toBe('applied');
    expect(getPlayQueueForServerMock).toHaveBeenCalledWith('srv-a');
    expect(playerState.queueItems[0]?.trackId).toBe('remote-a');
  });
});
