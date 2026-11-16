import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyMappedQueue,
  applyMappedQueueProjection,
  fingerprintFromLocalQueue,
  fingerprintFromServer,
  mergeQueueServerProjection,
  playQueueFingerprintsEqual,
} from '@/features/playback/store/applyServerPlayQueue';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { resetAllStores } from '@/test/helpers/storeReset';
import { makeAuthState, makeServer, makeTracks, seedQueue } from '@/test/helpers/factories';
import { useAuthStore } from '@/store/authStore';
import type { PlayQueueResult } from '@/lib/api/subsonicPlayQueue';
import type { Track } from '@/lib/media/trackTypes';

// Paused engine binding/prefetch is outside these queue-state assertions.
vi.mock('@/features/playback/store/pausedRestorePrepare', () => ({
  preparePausedRestoreOnStartup: vi.fn(),
}));

beforeEach(resetAllStores);

describe('playQueueFingerprintsEqual', () => {
  it('compares track order, current id, and position within tolerance', () => {
    const a = { trackIds: ['1', '2'], currentId: '1', positionMs: 1000 };
    const b = { trackIds: ['1', '2'], currentId: '1', positionMs: 2500 };
    expect(playQueueFingerprintsEqual(a, b)).toBe(true);
    expect(playQueueFingerprintsEqual(a, { ...b, positionMs: 4000 })).toBe(false);
  });

  it('fingerprintFromLocalQueue reads the player store', () => {
    usePlayerStore.setState({
      queueItems: [{ serverId: 'a.test', trackId: 't1' }],
      currentTrack: { id: 't1', title: 'T', artist: '', album: 'A', albumId: 'al', duration: 60 },
      currentTime: 3.5,
    });
    expect(fingerprintFromLocalQueue()).toEqual({
      trackIds: ['t1'],
      currentId: 't1',
      positionMs: 3500,
    });
  });

  it('fingerprintFromServer maps Subsonic playQueue fields', () => {
    expect(fingerprintFromServer({
      songs: [{ id: 'a' }, { id: 'b' }] as never,
      current: 'b',
      position: 1200,
    })).toEqual({
      trackIds: ['a', 'b'],
      currentId: 'b',
      positionMs: 1200,
    });
  });
});

describe('mergeQueueServerProjection', () => {
  it('replaces only the selected server slots and preserves mixed ordering', () => {
    const b1 = { serverId: 'b', trackId: 'b1' };
    expect(mergeQueueServerProjection(
      [
        { serverId: 'a', trackId: 'a1' },
        b1,
        { serverId: 'a', trackId: 'a2' },
      ],
      'a',
      [
        { serverId: 'a', trackId: 'a1' },
        { serverId: 'a', trackId: 'a3' },
      ],
    )).toEqual([
      { serverId: 'a', trackId: 'a1' },
      b1,
      { serverId: 'a', trackId: 'a3' },
    ]);
  });

  it('preserves local surplus by default and inserts remote surplus after the last prior slot', () => {
    const b1 = { serverId: 'b', trackId: 'b1' };
    expect(mergeQueueServerProjection(
      [
        { serverId: 'a', trackId: 'a1' },
        { serverId: 'a', trackId: 'a2' },
        b1,
      ],
      'a',
      [
        { serverId: 'a', trackId: 'a1' },
        { serverId: 'a', trackId: 'a3' },
        { serverId: 'a', trackId: 'a4' },
      ],
    )).toEqual([
      { serverId: 'a', trackId: 'a1' },
      { serverId: 'a', trackId: 'a3' },
      { serverId: 'a', trackId: 'a4' },
      b1,
    ]);

    expect(mergeQueueServerProjection(
      [{ serverId: 'a', trackId: 'a1' }, b1, { serverId: 'a', trackId: 'a2' }],
      'a',
      [{ serverId: 'a', trackId: 'a3' }],
    )).toEqual([{ serverId: 'a', trackId: 'a3' }, b1, { serverId: 'a', trackId: 'a2' }]);

    expect(mergeQueueServerProjection(
      [{ serverId: 'a', trackId: 'a1' }, b1, { serverId: 'a', trackId: 'a2' }],
      'a',
      [{ serverId: 'a', trackId: 'a3' }],
      false,
    )).toEqual([{ serverId: 'a', trackId: 'a3' }, b1]);
  });
});

describe('applyMappedQueueProjection', () => {
  it('preserves the current non-target item and updates its shifted index', () => {
    const currentTrack = { id: 'b1', title: 'B1', artist: '', album: '', albumId: '', duration: 60, serverId: 'b' };
    usePlayerStore.setState({
      queueItems: [
        { serverId: 'a', trackId: 'a1' },
        { serverId: 'a', trackId: 'a2' },
        { serverId: 'b', trackId: 'b1' },
      ],
      queueIndex: 2,
      currentTrack,
      queueSource: { kind: 'playlist', id: 'mixed' },
    });

    applyMappedQueueProjection(
      [
        { id: 'a1', title: 'A1', artist: '', album: '', albumId: '', duration: 60, serverId: 'a' },
        { id: 'a3', title: 'A3', artist: '', album: '', albumId: '', duration: 60, serverId: 'a' },
        { id: 'a4', title: 'A4', artist: '', album: '', albumId: '', duration: 60, serverId: 'a' },
      ],
      { songs: [] as never, current: 'a1', position: 12_000 },
      'a',
    );

    expect(usePlayerStore.getState().queueItems.map(ref => ref.trackId)).toEqual(['a1', 'a3', 'a4', 'b1']);
    expect(usePlayerStore.getState().queueIndex).toBe(3);
    expect(usePlayerStore.getState().currentTrack).toBe(currentTrack);
    expect(usePlayerStore.getState().currentTime).toBe(0);
    expect(usePlayerStore.getState().queueSource).toBeNull();
  });
});

describe('server queue provenance', () => {
  const source = { kind: 'album' as const, id: 'album-a', serverId: 'profile-a' };
  let tracks: Track[];

  function remote(mapped: Track[], index = 0): PlayQueueResult {
    return { songs: mapped, current: mapped[index]?.id, position: 12_000 };
  }

  beforeEach(() => {
    useAuthStore.setState(makeAuthState({ servers: [makeServer({ id: 'profile-a', url: 'https://a.test' })] }));
    tracks = makeTracks(3, i => ({ id: `a${i}`, serverId: 'profile-a', albumId: 'album-a' }));
    seedQueue(tracks, { serverId: 'profile-a' });
    usePlayerStore.setState({ queueSource: source });
  });

  it.each(['reordered', 'other owner', 'missing owner', 'longer'] as const)(
    'clears the source for a direct %s queue', kind => {
      const previous = usePlayerStore.getState().queueItems;
      if (kind === 'other owner' || kind === 'missing owner') {
        usePlayerStore.setState({
          queueItems: previous.map(ref => ({ ...ref, serverId: kind === 'other owner' ? 'b.test' : '' })),
        });
      }
      const mapped = kind === 'reordered' ? [...tracks].reverse()
        : kind === 'longer' ? [...tracks, { ...tracks[0], id: 'extra' }] : tracks;

      applyMappedQueue(mapped, remote(mapped), 'profile-a', true, 0);

      expect(usePlayerStore.getState().queueSource).toBeNull();
    },
  );

  it.each([0, 2])('retains the source for direct position/current-slot sync at %i', index => {
    // Older refs may carry a profile id and an engine's stream: prefix.
    usePlayerStore.setState({
      queueItems: tracks.map(track => ({ serverId: 'profile-a', trackId: `stream:${track.id}` })),
    });
    const mapped = tracks.map(track => ({ ...track, title: 'Refreshed', albumId: 'physical-merged-album' }));

    applyMappedQueue(mapped, remote(mapped, index), 'a.test', true, 0);

    expect(usePlayerStore.getState().queueSource).toBe(source);
    expect(usePlayerStore.getState().queueIndex).toBe(index);
    expect(usePlayerStore.getState().currentTime).toBe(12);
  });

  it('clears the source when projection replaces another slot without moving the current one', () => {
    const mapped = [tracks[0], { ...tracks[1], id: 'replacement' }, tracks[2]];

    applyMappedQueueProjection(mapped, remote(mapped), 'profile-a');

    expect(usePlayerStore.getState().currentTrack).toBe(tracks[0]);
    expect(usePlayerStore.getState().queueIndex).toBe(0);
    expect(usePlayerStore.getState().queueSource).toBeNull();
  });

  it('retains the source for the same ordered projection across profile/index keys', () => {
    usePlayerStore.setState({ queueItems: tracks.map(track => ({ serverId: 'profile-a', trackId: track.id })) });
    const mapped = tracks.map(track => ({ ...track, title: 'Refreshed' }));

    applyMappedQueueProjection(mapped, remote(mapped, 2), 'profile-a');

    expect(usePlayerStore.getState().queueSource).toBe(source);
    expect(usePlayerStore.getState().currentTrack).toBe(tracks[0]);
  });

  it('clears the source in the no-mapped-current projection branch', () => {
    // The network wrapper rejects empty queues; the exported projection helper
    // also supports removing all target slots without a mapped replacement.
    usePlayerStore.setState(state => ({
      queueItems: [...state.queueItems, { serverId: 'b.test', trackId: 'b1' }],
    }));

    applyMappedQueueProjection([], remote([]), 'profile-a', false);

    expect(usePlayerStore.getState().queueItems).toEqual([{ serverId: 'b.test', trackId: 'b1' }]);
    expect(usePlayerStore.getState().queueSource).toBeNull();
  });

  it('retains the source when an empty projection preserves every local surplus slot', () => {
    applyMappedQueueProjection([], remote([]), 'profile-a');

    expect(usePlayerStore.getState().queueItems.map(ref => ref.trackId)).toEqual(tracks.map(track => track.id));
    expect(usePlayerStore.getState().queueSource).toBe(source);
  });
});
