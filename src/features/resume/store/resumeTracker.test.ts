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
import { makeTracks } from '@/test/helpers/factories';
import { onInvoke, registerDefaultCoverInvokeHandlers } from '@/test/mocks/tauri';
import { useAuthStore } from '@/store/authStore';
import type { Track } from '@/lib/media/trackTypes';
import { initResumeTracker, _resetResumeTrackerForTest } from './resumeTracker';
import { useResumePointsStore } from './resumePointsStore';

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
