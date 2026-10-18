import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerOrbitRuntime, type OrbitSnapshot } from '@/store/orbitRuntime';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { resetAllStores } from '@/test/helpers/storeReset';
import { makeTrack, seedQueue } from '@/test/helpers/factories';

const suggestTracks = vi.fn(async () => {});
const bulkGuard = vi.fn(async () => true);
let snapshot: OrbitSnapshot;

registerOrbitRuntime({
  getSnapshot: () => snapshot,
  bulkGuard,
  allowsTrackServer: () => true,
  suggestTracks,
});

const queueIds = () => usePlayerStore.getState().queueItems.map(ref => ref.trackId);
const suggestedIds = () => suggestTracks.mock.calls.map(call => (call as unknown as [Array<{ id: string }>])[0].map(t => t.id));

describe('queue additions of an Orbit guest', () => {
  beforeEach(() => {
    resetAllStores();
    suggestTracks.mockClear();
    bulkGuard.mockClear();
    seedQueue([makeTrack({ id: 'host-1' })]);
    snapshot = { role: 'guest', phase: 'active', state: null, serverId: 'srv' };
  });

  it('Add to queue and Play next become suggestions; the local queue stays as the host set it', () => {
    usePlayerStore.getState().enqueue([makeTrack({ id: 'q1', serverId: 'srv' })]);
    usePlayerStore.getState().playNext([makeTrack({ id: 'n1', serverId: 'srv' })]);
    expect(suggestedIds()).toEqual([['q1'], ['n1']]);
    expect(queueIds()).toEqual(['host-1']);
  });

  it('Play All asks first, then suggests the whole list', async () => {
    const album = [makeTrack({ id: 'a1' }), makeTrack({ id: 'a2' }), makeTrack({ id: 'a3' })];
    usePlayerStore.getState().playTrack(album[0], album);
    await vi.waitFor(() => expect(suggestTracks).toHaveBeenCalledTimes(1));
    expect(bulkGuard).toHaveBeenCalledWith(3);
    expect(suggestedIds()).toEqual([['a1', 'a2', 'a3']]);
    expect(queueIds()).toEqual(['host-1']);
  });

  it('suggests nothing when the guest cancels the question', async () => {
    bulkGuard.mockResolvedValueOnce(false);
    usePlayerStore.getState().enqueue([makeTrack({ id: 'b1' }), makeTrack({ id: 'b2' })]);
    await vi.waitFor(() => expect(bulkGuard).toHaveBeenCalledWith(2));
    expect(suggestTracks).not.toHaveBeenCalled();
    expect(queueIds()).toEqual(['host-1']);
  });

  it('the host, and a guest still joining, keep the local queue change', () => {
    snapshot = { role: 'host', phase: 'active', state: null, serverId: 'srv' };
    usePlayerStore.getState().enqueue([makeTrack({ id: 'h1' })]);
    snapshot = { role: 'guest', phase: 'joining', state: null, serverId: 'srv' };
    usePlayerStore.getState().enqueue([makeTrack({ id: 'j1' })]);
    expect(suggestTracks).not.toHaveBeenCalled();
    expect(queueIds()).toEqual(['host-1', 'h1', 'j1']);
  });
});
