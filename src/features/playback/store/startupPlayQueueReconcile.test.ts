import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { resetAllStores } from '@/test/helpers/storeReset';
import { useAuthStore } from '@/store/authStore';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { usePlayQueueSyncSettingsStore } from '@/features/playback/store/playQueueSyncSettingsStore';
import {
  _resetQueueResolverForTest,
  getCachedTrack,
} from '@/features/playback/store/queueTrackResolver';

const { fetchPlayQueueForServerMock, applyMappedQueueMock } = vi.hoisted(() => ({
  fetchPlayQueueForServerMock: vi.fn(),
  applyMappedQueueMock: vi.fn(),
}));

vi.mock('@/lib/api/subsonicPlayQueue', () => ({
  fetchPlayQueueForServer: fetchPlayQueueForServerMock,
}));

vi.mock('@/features/playback/store/applyServerPlayQueue', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/playback/store/applyServerPlayQueue')>(),
  applyMappedQueue: applyMappedQueueMock,
}));

import { reconcileStartupPlayQueues } from './startupPlayQueueReconcile';

function remote(ids: string[], current = ids[0]) {
  return {
    songs: ids.map(id => ({ id, title: id, album: 'Album', artist: 'Artist', duration: 100 })) as SubsonicSong[],
    current,
    position: 12_000,
  };
}

beforeEach(() => {
  resetAllStores();
  usePlayQueueSyncSettingsStore.setState({ enabled: true });
  _resetQueueResolverForTest();
  fetchPlayQueueForServerMock.mockReset();
  applyMappedQueueMock.mockReset();
  useAuthStore.setState({
    servers: [
      { id: 'a', name: 'A', url: 'http://a.test', username: 'u', password: 'p' },
      { id: 'b', name: 'B', url: 'http://b.test', username: 'u', password: 'p' },
    ],
    activeServerId: 'a',
    libraryBrowseServerIds: ['a', 'b'],
  });
  usePlayerStore.setState({
    queueItems: [
      { serverId: 'a', trackId: 'a1' },
      { serverId: 'b', trackId: 'b1' },
      { serverId: 'a', trackId: 'a2' },
    ],
    queueIndex: 1,
    currentTrack: { id: 'b1', title: 'b1', artist: 'Artist', album: 'Album', albumId: 'album', duration: 100, serverId: 'b' },
    isPlaying: false,
    currentRadio: null,
  });
});

describe('reconcileStartupPlayQueues', () => {

  it('preserves the local queue without fetching when play queue sync is disabled', async () => {
    const localQueue = usePlayerStore.getState().queueItems.map(ref => ({ ...ref }));
    usePlayQueueSyncSettingsStore.setState({ enabled: false });

    await expect(reconcileStartupPlayQueues()).resolves.toBe('kept-local');

    expect(fetchPlayQueueForServerMock).not.toHaveBeenCalled();
    expect(applyMappedQueueMock).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().queueItems).toEqual(localQueue);
  });

  it('does not apply a single-server queue if sync is disabled during a fetch', async () => {
    useAuthStore.setState({ libraryBrowseServerIds: ['a'] });
    const localQueue = [{ serverId: 'a', trackId: 'a1' }, { serverId: 'a', trackId: 'a2' }];
    usePlayerStore.setState({
      queueItems: localQueue,
      queueIndex: 0,
      currentTrack: { id: 'a1', title: 'a1', artist: 'Artist', album: 'Album', albumId: 'album', duration: 100, serverId: 'a' },
    });
    let resolveFetch: ((value: ReturnType<typeof remote>) => void) | undefined;
    fetchPlayQueueForServerMock.mockImplementation(() => new Promise<ReturnType<typeof remote>>(resolve => {
      resolveFetch = resolve;
    }));

    const reconciliation = reconcileStartupPlayQueues();
    expect(fetchPlayQueueForServerMock).toHaveBeenCalledWith('a');
    usePlayQueueSyncSettingsStore.setState({ enabled: false });
    resolveFetch?.(remote(['a1', 'a3'], 'a1'));

    await expect(reconciliation).resolves.toBe('kept-local');
    expect(applyMappedQueueMock).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().queueItems).toEqual(localQueue);
  });

  it('does not apply a mixed-server projection if sync is disabled during a fetch', async () => {
    const localQueue = usePlayerStore.getState().queueItems.map(ref => ({ ...ref }));
    let resolveA: ((value: ReturnType<typeof remote>) => void) | undefined;
    fetchPlayQueueForServerMock.mockImplementation((serverId: string) => (
      serverId === 'a'
        ? new Promise<ReturnType<typeof remote>>(resolve => { resolveA = resolve; })
        : Promise.resolve(remote(['b1'], 'b1'))
    ));

    const reconciliation = reconcileStartupPlayQueues();
    expect(fetchPlayQueueForServerMock).toHaveBeenCalledTimes(2);
    usePlayQueueSyncSettingsStore.setState({ enabled: false });
    resolveA?.(remote(['a1', 'a3'], 'a1'));

    await expect(reconciliation).resolves.toBe('kept-local');
    expect(applyMappedQueueMock).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().queueItems).toEqual(localQueue);
  });

  it('keeps the persisted mixed queue when all server projections match', async () => {
    fetchPlayQueueForServerMock.mockImplementation(async (serverId: string) => (
      serverId === 'a'
        ? { ...remote(['a1', 'a2'], 'a1'), position: 98_000 }
        : remote(['b1'], 'b1')
    ));
    await expect(reconcileStartupPlayQueues()).resolves.toBe('kept-local');
    expect(applyMappedQueueMock).not.toHaveBeenCalled();
  });

  it('applies a changed non-active server projection with the reconciled owner', async () => {
    const currentTrack = { id: 'a1', title: 'a1', artist: 'Artist', album: 'Album', albumId: 'album', duration: 100, serverId: 'a' };
    usePlayerStore.setState({ queueIndex: 0, currentTrack });
    fetchPlayQueueForServerMock.mockImplementation(async (serverId: string) => (
      serverId === 'a' ? remote(['a1', 'a2'], 'a1') : remote(['b1', 'b2'], 'b1')
    ));
    await expect(reconcileStartupPlayQueues()).resolves.toBe('applied');
    expect(applyMappedQueueMock).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().queueItems).toEqual([
      { serverId: 'a', trackId: 'a1' },
      { serverId: 'b.test', trackId: 'b1' },
      { serverId: 'b.test', trackId: 'b2' },
      { serverId: 'a', trackId: 'a2' },
    ]);
    expect(usePlayerStore.getState().queueIndex).toBe(0);
    expect(usePlayerStore.getState().currentTrack).toBe(currentTrack);
    expect(getCachedTrack({ serverId: 'b.test', trackId: 'b2' })?.serverId).toBe('b');
  });

  it('keeps the existing whole-queue apply behavior for a single-server queue', async () => {
    useAuthStore.setState({ libraryBrowseServerIds: ['a'] });
    usePlayerStore.setState({
      queueItems: [{ serverId: 'a', trackId: 'a1' }, { serverId: 'a', trackId: 'a2' }],
      queueIndex: 0,
      currentTrack: { id: 'a1', title: 'a1', artist: 'Artist', album: 'Album', albumId: 'album', duration: 100, serverId: 'a' },
    });
    fetchPlayQueueForServerMock.mockResolvedValue(remote(['a1', 'a3'], 'a1'));

    await expect(reconcileStartupPlayQueues()).resolves.toBe('applied');
    expect(applyMappedQueueMock).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'a3', serverId: 'a' })]),
      expect.objectContaining({ current: 'a1' }),
      'a',
      true,
      0,
    );
  });

  it('keeps local when more than one server changed', async () => {
    fetchPlayQueueForServerMock.mockImplementation(async (serverId: string) => (
      serverId === 'a' ? remote(['a3']) : remote(['b2'])
    ));
    await expect(reconcileStartupPlayQueues()).resolves.toBe('kept-local');
    expect(applyMappedQueueMock).not.toHaveBeenCalled();
  });

  it('keeps local when any selected server fails or is empty', async () => {
    fetchPlayQueueForServerMock.mockImplementation(async (serverId: string) => {
      if (serverId === 'b') throw new Error('offline');
      return remote(['a3']);
    });
    await expect(reconcileStartupPlayQueues()).resolves.toBe('kept-local');

    fetchPlayQueueForServerMock.mockImplementation(async (serverId: string) => (
      serverId === 'a' ? remote(['a1', 'a2'], 'a1') : remote([])
    ));
    await expect(reconcileStartupPlayQueues()).resolves.toBe('kept-local');
    expect(applyMappedQueueMock).not.toHaveBeenCalled();
  });

  it('keeps local when selected scope does not cover the mixed queue', async () => {
    useAuthStore.setState({ libraryBrowseServerIds: ['a'] });
    await expect(reconcileStartupPlayQueues()).resolves.toBe('kept-local');
    expect(fetchPlayQueueForServerMock).not.toHaveBeenCalled();
  });

  it('keeps a queue that changed locally while remote comparisons were in flight', async () => {
    let resolveA: ((value: ReturnType<typeof remote>) => void) | undefined;
    fetchPlayQueueForServerMock.mockImplementation((serverId: string) => {
      if (serverId === 'a') {
        return new Promise(resolve => { resolveA = resolve; });
      }
      return Promise.resolve(remote(['b1'], 'b1'));
    });
    const reconciliation = reconcileStartupPlayQueues();
    usePlayerStore.setState(state => ({
      queueItems: [...state.queueItems, { serverId: 'a', trackId: 'a-local' }],
    }));
    resolveA?.(remote(['a1', 'a3'], 'a1'));

    await expect(reconciliation).resolves.toBe('kept-local');
    expect(applyMappedQueueMock).not.toHaveBeenCalled();
  });
});
