/**
 * The playlist a queue was started from (`queueSource`), which drives the
 * now-playing marker on playlist cards and sidebar rows. Runs through the real
 * store, because a new list reaches the queue only after `playTrack` re-enters
 * itself through the bulk gate — the source has to survive that hop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { takePendingQueueSource, withQueueSource } from '@/features/playback/store/pendingQueueSource';
import { resetAllStores } from '@/test/helpers/storeReset';
import { makeTracks } from '@/test/helpers/factories';
import { onInvoke, registerDefaultCoverInvokeHandlers } from '@/test/mocks/tauri';
import { useAuthStore } from '@/store/authStore';

const SOURCE = { kind: 'playlist' as const, id: 'pl-1', serverId: 'srv' };

beforeEach(() => {
  resetAllStores();
  const id = useAuthStore.getState().addServer({
    name: 'T', url: 'https://source.test', username: 'tester', password: 'p',
  });
  useAuthStore.getState().setActiveServer(id);
  registerDefaultCoverInvokeHandlers();
  onInvoke('audio_play', () => undefined);
  onInvoke('audio_stop', () => undefined);
  onInvoke('audio_seek', () => undefined);
  onInvoke('audio_get_state', () => ({ playing: false }));
  onInvoke('audio_update_replay_gain', () => undefined);
  onInvoke('discord_update_presence', () => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function playList(list = makeTracks(4), source?: typeof SOURCE) {
  const start = () => usePlayerStore.getState().playTrack(list[0]!, list);
  if (source) withQueueSource(source, start);
  else start();
  await vi.waitFor(() => {
    expect(usePlayerStore.getState().queueItems.map(ref => ref.trackId)).toEqual(list.map(t => t.id));
  });
  return list;
}

describe('withQueueSource', () => {
  it('hands the source to one taker and never leaks it past its callback', () => {
    withQueueSource(SOURCE, () => {
      expect(takePendingQueueSource()).toEqual(SOURCE);
      expect(takePendingQueueSource()).toBeNull();
    });
    withQueueSource(SOURCE, () => undefined);
    expect(takePendingQueueSource()).toBeNull();
  });
});

describe('queueSource', () => {
  it('records the playlist a new queue was started from', async () => {
    await playList(undefined, SOURCE);
    expect(usePlayerStore.getState().queueSource).toEqual(SOURCE);
  });

  it('keeps it while playback moves within that queue', async () => {
    const list = await playList(undefined, SOURCE);
    usePlayerStore.getState().playTrack(list[2]!, undefined, true, false, 2);
    await vi.waitFor(() => expect(usePlayerStore.getState().queueIndex).toBe(2));
    expect(usePlayerStore.getState().queueSource).toEqual(SOURCE);
  });

  it('drops it when another list replaces the queue', async () => {
    await playList(undefined, SOURCE);
    await playList(makeTracks(3));
    expect(usePlayerStore.getState().queueSource).toBeNull();
  });

  it('drops it when the queue is cleared', async () => {
    await playList(undefined, SOURCE);
    usePlayerStore.getState().clearQueue();
    expect(usePlayerStore.getState().queueSource).toBeNull();
  });

  it('drops it when an Instant Mix reseeds the queue from the current track', async () => {
    const list = await playList(undefined, SOURCE);
    usePlayerStore.setState({ currentTrack: list[0]! });
    usePlayerStore.getState().reseedQueueForInstantMix(list[0]!);
    expect(usePlayerStore.getState().queueSource).toBeNull();
  });
});
