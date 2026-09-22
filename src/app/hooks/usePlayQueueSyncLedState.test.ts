import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canAutoIdlePlayQueuePull, usePlayQueueSyncLedState } from '@/app/hooks/usePlayQueueSyncLedState';
import {
  _resetQueueSyncUiForTest,
  markQueueHandoffPending,
} from '@/features/playback/store/queueSyncUiState';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { useAuthStore } from '@/store/authStore';
import { resetAllStores } from '@/test/helpers/storeReset';
import { usePlayQueueSyncSettingsStore } from '@/features/playback/store/playQueueSyncSettingsStore';

const pullPlayQueueFromServerMock = vi.fn();

vi.mock('@/features/playback/store/applyServerPlayQueue', () => ({
  pullPlayQueueFromServer: (...args: unknown[]) => pullPlayQueueFromServerMock(...args),
}));

describe('usePlayQueueSyncLedState', () => {
  beforeEach(() => {
    resetAllStores();
    _resetQueueSyncUiForTest();
    pullPlayQueueFromServerMock.mockReset();
    useAuthStore.setState({
      servers: [
        { id: 'a', name: 'A', url: 'http://a.test', username: 'u', password: 'p' },
        { id: 'b', name: 'B', url: 'http://b.test', username: 'u', password: 'p' },
      ],
      activeServerId: 'a',
    });
  });

  it('keeps a mixed queue green and pulls each owner projection without a browse handoff', async () => {
    usePlayerStore.setState({
      queueItems: [
        { serverId: 'a', trackId: 'a1' },
        { serverId: 'b', trackId: 'b1' },
        { serverId: 'a', trackId: 'a2' },
      ],
      queueIndex: 1,
      currentTrack: { id: 'b1', title: 'b1', artist: '', album: '', albumId: '', duration: 60, serverId: 'b' },
    });
    markQueueHandoffPending();

    const { result } = renderHook(() => usePlayQueueSyncLedState('connected'));

    expect(result.current.ledVariant).toBe('connected');
    expect(result.current.needsQueuePull).toBe(false);
    expect(result.current.queueHandoffReason).toBe(false);
    expect(result.current.syncRingVisible).toBe(false);

    pullPlayQueueFromServerMock.mockResolvedValue('noop');
    await act(() => result.current.pullFromActiveServer());
    expect(pullPlayQueueFromServerMock).toHaveBeenCalledTimes(2);
    expect(pullPlayQueueFromServerMock).toHaveBeenNthCalledWith(1, 'a');
    expect(pullPlayQueueFromServerMock).toHaveBeenNthCalledWith(2, 'b');
  });

  it('keeps a single-server queue synced with its playback owner, not active server', () => {
    usePlayerStore.setState({
      queueItems: [{ serverId: 'b', trackId: 'b1' }],
      queueIndex: 0,
      currentTrack: { id: 'b1', title: 'b1', artist: '', album: '', albumId: '', duration: 60, serverId: 'b' },
    });

    const { result } = renderHook(() => usePlayQueueSyncLedState('connected'));

    expect(result.current.ledVariant).toBe('connected');
    expect(result.current.queueHandoffReason).toBe(false);
    expect(canAutoIdlePlayQueuePull('connected', null)).toBe(true);
  });

  it('hides queue handoff controls and skips manual pull when sync is disabled', async () => {
    usePlayerStore.setState({
      queueItems: [{ serverId: 'a', trackId: 'a1' }],
      queueIndex: 0,
      currentTrack: { id: 'a1', title: 'a1', artist: '', album: '', albumId: '', duration: 60, serverId: 'a' },
    });
    usePlayQueueSyncSettingsStore.getState().setEnabled(false);

    const { result } = renderHook(() => usePlayQueueSyncLedState('connected'));

    expect(canAutoIdlePlayQueuePull('connected', null)).toBe(false);
    expect(result.current.syncRingVisible).toBe(false);
    await act(() => result.current.pullFromActiveServer());
    expect(pullPlayQueueFromServerMock).not.toHaveBeenCalled();
  });
});
