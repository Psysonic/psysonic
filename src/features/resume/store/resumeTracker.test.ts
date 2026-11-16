/**
 * Resume points through the real player store: a list started from its page,
 * a track of it played to the end, then the queue replaced by something else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { withQueueSource, type QueueSource } from '@/features/playback/store/pendingQueueSource';
import { emitNaturalTrackEnd } from '@/features/playback/store/naturalTrackEnd';
import { usePrivateModeStore } from '@/features/privateMode/privateModeStore';
import { resetAllStores } from '@/test/helpers/storeReset';
import { makeTrack, makeTracks } from '@/test/helpers/factories';
import { onInvoke, registerDefaultCoverInvokeHandlers } from '@/test/mocks/tauri';
import { useAuthStore } from '@/store/authStore';
import type { Track } from '@/lib/media/trackTypes';
import { initResumeTracker, _resetResumeTrackerForTest } from './resumeTracker';
import { useResumePointsStore } from './resumePointsStore';
import { applyMappedQueue, applyMappedQueueProjection } from '@/features/playback/store/applyServerPlayQueue';
import type { PlayQueueResult } from '@/lib/api/subsonicPlayQueue';

// Keep the real queue/player/tracker graph, but do not bind a paused native
// engine or prefetch bytes during server restore.
vi.mock('@/features/playback/store/pausedRestorePrepare', () => ({
  preparePausedRestoreOnStartup: vi.fn(),
}));

const ALBUM: QueueSource = { kind: 'album', id: 'al-1' };
const PLAYLIST: QueueSource = { kind: 'playlist', id: 'pl-1' };

let stopTracker: () => void = () => {};

beforeEach(() => {
  resetAllStores();
  useResumePointsStore.setState({ points: [], session: null });
  usePrivateModeStore.getState().setActive(false);
  _resetResumeTrackerForTest();
  const id = useAuthStore.getState().addServer({
    name: 'T', url: 'https://resume.test', username: 'tester', password: 'p',
  });
  useAuthStore.getState().setActiveServer(id);
  registerDefaultCoverInvokeHandlers();
  onInvoke('audio_play', () => undefined);
  onInvoke('audio_stop', () => undefined);
  onInvoke('audio_seek', () => undefined);
  onInvoke('audio_get_state', () => ({ playing: false }));
  onInvoke('audio_update_replay_gain', () => undefined);
  onInvoke('discord_update_presence', () => undefined);
  stopTracker = initResumeTracker({ playlistName: () => 'Road mix' });
});

afterEach(() => {
  stopTracker();
  vi.restoreAllMocks();
});

async function playList(list: Track[], source?: QueueSource, index = 0) {
  const start = () => usePlayerStore.getState().playTrack(list[index]!, list, true, false, index);
  if (source) withQueueSource(source, start);
  else start();
  await vi.waitFor(() => {
    expect(usePlayerStore.getState().queueItems.map(ref => ref.trackId)).toEqual(list.map(t => t.id));
  });
  return list;
}

/** Play the current track to its end and let the queue move to the next one. */
async function finishCurrentTrack() {
  emitNaturalTrackEnd();
  const { queueItems, queueIndex } = usePlayerStore.getState();
  if (queueIndex >= queueItems.length - 1) return;
  usePlayerStore.getState().next(false);
  await vi.waitFor(() => expect(usePlayerStore.getState().queueIndex).toBe(queueIndex + 1));
}

describe('server queue replacement resume provenance', () => {
  it.each([
    { projection: false, playing: false },
    { projection: false, playing: true },
    { projection: true, playing: false },
    { projection: true, playing: true },
  ])('flushes A before B replaces it (projection=$projection, playing=$playing)', async ({ projection, playing }) => {
    const serverId = useAuthStore.getState().activeServerId!;
    const album = makeTracks(4, () => ({ album: 'Album A', albumId: ALBUM.id, serverId }));
    const list = projection ? [...album, makeTrack({ serverId: 'other', albumId: 'physical-other' })] : album;
    await playList(list, { ...ALBUM, serverId });
    await finishCurrentTrack();
    usePlayerStore.setState({ currentTime: 61, isPlaying: playing });
    const remoteTracks = makeTracks(3, () => ({ album: 'Album B', albumId: 'album-b', serverId, duration: 40 }));
    const remote: PlayQueueResult = { songs: remoteTracks, current: remoteTracks[1].id, position: 11_605 };
    const audioPlay = vi.fn();
    onInvoke('audio_play', audioPlay);

    if (projection) applyMappedQueueProjection(remoteTracks, remote, serverId);
    else applyMappedQueue(remoteTracks, remote, serverId, true, 0);

    // Immediate save must use the snapshot from BEFORE the atomic queue/source
    // update, not A's list identity combined with B's current track or slot.
    expect(useResumePointsStore.getState().points).toHaveLength(1);
    const saved = useResumePointsStore.getState().points[0];
    expect(saved).toMatchObject({
      kind: 'album', id: ALBUM.id, name: 'Album A', trackId: album[1].id,
      trackIndex: 1, trackCount: list.length, positionSec: 61, durationSec: 180,
      cover: { albumId: ALBUM.id, coverArt: album[1].coverArt },
    });
    expect(usePlayerStore.getState().queueSource).toBeNull();
    expect(useResumePointsStore.getState().session).toBeNull();
    if (playing && !projection) {
      await vi.waitFor(() => expect(audioPlay).toHaveBeenCalledWith(expect.objectContaining({ analysisTrackId: remoteTracks[1].id })));
    }
    expect(usePlayerStore.getState().currentTrack?.id).toBe(remoteTracks[1].id);

    usePlayerStore.setState({ currentTime: 22 });
    await finishCurrentTrack();
    await finishCurrentTrack();
    await playList(makeTracks(2, () => ({ albumId: 'new-album' })), { kind: 'album', id: 'new-album' });

    // Foreign progress/end events must neither overwrite nor remove A's point.
    expect(useResumePointsStore.getState().points).toEqual([saved]);
  });

  it('flushes the original index/count when projection preserves but shifts the current track', async () => {
    const serverId = useAuthStore.getState().activeServerId!;
    const other = makeTrack({ serverId: 'other', albumId: 'physical-other' });
    const album = makeTracks(2, () => ({ album: 'Album A', albumId: ALBUM.id, serverId }));
    await playList([...album, other], { ...ALBUM, serverId });
    await finishCurrentTrack();
    usePlayerStore.getState().playTrack(other, undefined, true, false, 2);
    await vi.waitFor(() => expect(usePlayerStore.getState().queueIndex).toBe(2));
    usePlayerStore.setState({ currentTime: 61 });
    // Reattaching after startup must retain a persisted qualified session and
    // snapshot the pre-projection queue, just as for uninterrupted playback.
    stopTracker();
    stopTracker = initResumeTracker({ playlistName: () => 'Road mix' });
    expect(useResumePointsStore.getState().session).toMatchObject({ id: ALBUM.id, qualified: true });
    const mapped = [...album, makeTrack({ serverId, albumId: 'album-b' })];

    applyMappedQueueProjection(mapped, { songs: mapped, current: mapped[0].id, position: 0 }, serverId);

    expect(usePlayerStore.getState().currentTrack?.id).toBe(other.id);
    expect(usePlayerStore.getState().queueIndex).toBe(3);
    expect(useResumePointsStore.getState().points[0]).toMatchObject({
      id: ALBUM.id, trackId: other.id, trackIndex: 2, trackCount: 3, positionSec: 61,
    });
    expect(usePlayerStore.getState().queueSource).toBeNull();
  });

  it.each([1, 2])('retains a playing album source through position/current-slot sync to slot %i', async index => {
    const serverId = useAuthStore.getState().activeServerId!;
    // A merged album may legitimately contain different physical album ids.
    const album = makeTracks(4, i => ({ album: 'Merged A', albumId: `physical-${i % 2}`, serverId }));
    await playList(album, { ...ALBUM, serverId });
    await finishCurrentTrack();
    usePlayerStore.setState({ currentTime: 61, isPlaying: true });
    const source = usePlayerStore.getState().queueSource;
    const audioPlay = vi.fn();
    onInvoke('audio_play', audioPlay);

    applyMappedQueue(album, { songs: album, current: album[index].id, position: 12_000 }, serverId, true, 0);

    if (index !== 1) {
      // Observe the real asynchronous playTrack replacement, not just the
      // immediate server-sync setState that precedes its source handoff.
      await vi.waitFor(() => expect(audioPlay).toHaveBeenCalledWith(expect.objectContaining({ analysisTrackId: album[index].id })));
    } else {
      expect(audioPlay).not.toHaveBeenCalled();
    }
    expect(usePlayerStore.getState().queueSource).toBe(source);
    expect(useResumePointsStore.getState().session).toMatchObject({ id: ALBUM.id, qualified: true });
    expect(useResumePointsStore.getState().points).toEqual([]);
    await playList(makeTracks(2));
    expect(useResumePointsStore.getState().points[0]).toMatchObject({
      id: ALBUM.id, name: 'Merged A', trackId: album[index].id, trackIndex: index, trackCount: 4,
    });
  });
});

describe('resume points', () => {
  it('stores where an album was left once one of its tracks played to the end', async () => {
    const album = await playList(makeTracks(5, () => ({ album: 'Night Drive' })), ALBUM);
    await finishCurrentTrack();
    usePlayerStore.setState({ currentTime: 95 });

    await playList(makeTracks(2));

    const [point] = useResumePointsStore.getState().points;
    expect(point).toMatchObject({
      kind: 'album',
      id: 'al-1',
      name: 'Night Drive',
      trackId: album[1]!.id,
      trackIndex: 1,
      trackCount: 5,
      positionSec: 95,
    });
  });

  it('leaves no point when no track of the list finished', async () => {
    await playList(makeTracks(5), ALBUM);
    usePlayerStore.setState({ currentTime: 120 });
    await playList(makeTracks(2));
    expect(useResumePointsStore.getState().points).toEqual([]);
  });

  it('names a playlist point after the playlist', async () => {
    await playList(makeTracks(4), PLAYLIST);
    await finishCurrentTrack();
    await playList(makeTracks(2));
    expect(useResumePointsStore.getState().points[0]).toMatchObject({ kind: 'playlist', name: 'Road mix' });
  });

  it('keeps the last position when the queue is stopped and cleared', async () => {
    await playList(makeTracks(4), ALBUM);
    await finishCurrentTrack();
    usePlayerStore.setState({ currentTime: 61 });
    usePlayerStore.getState().clearQueue();
    expect(useResumePointsStore.getState().points[0]?.positionSec).toBe(61);
  });

  it('removes the point once the list has run to its last track', async () => {
    useResumePointsStore.setState({
      points: [{
        kind: 'album', id: 'al-1', serverKey: 'resume.test', name: 'Night Drive', trackId: 'x',
        trackIndex: 0, trackCount: 2, positionSec: 10, durationSec: 180, cover: {}, updatedAt: 1,
      }],
    });
    await playList(makeTracks(2), ALBUM);
    await finishCurrentTrack();
    await finishCurrentTrack();
    await playList(makeTracks(2));
    expect(useResumePointsStore.getState().points).toEqual([]);
  });

  it('starts no session for a list played in random order', async () => {
    await playList(makeTracks(4), { ...PLAYLIST, shuffled: true });
    expect(useResumePointsStore.getState().session).toBeNull();
    await finishCurrentTrack();
    await playList(makeTracks(2));
    expect(useResumePointsStore.getState().points).toEqual([]);
  });

  it('records nothing in private mode', async () => {
    await playList(makeTracks(4), ALBUM);
    await finishCurrentTrack();
    usePrivateModeStore.getState().setActive(true);
    await playList(makeTracks(2));
    expect(useResumePointsStore.getState().points).toEqual([]);
  });

  it('treats a list continued from its point as already qualified', async () => {
    const album = makeTracks(5);
    await playList(album, ALBUM);
    await finishCurrentTrack();
    await playList(makeTracks(2));
    expect(useResumePointsStore.getState().points).toHaveLength(1);

    // Resume at track 2 and leave again before it ends: the point moves with it.
    await playList(album, ALBUM, 1);
    expect(useResumePointsStore.getState().session?.qualified).toBe(true);
    usePlayerStore.setState({ currentTime: 30 });
    await playList(makeTracks(2));
    expect(useResumePointsStore.getState().points[0]).toMatchObject({ trackIndex: 1, positionSec: 30 });
  });
});
