import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/cover/resolveEntryLibrary', () => ({
  resolveTrackCoverRefFromLibrary: vi.fn(() => Promise.resolve({
    cacheKind: 'album',
    cacheEntityId: 'al-1',
    fetchCoverArtId: 'al-1',
    serverScope: { kind: 'playback' },
  })),
}));
vi.mock('@/cover/integrations/notification', () => ({
  coverArtPathForNotification: vi.fn(() => Promise.resolve('/cover-cache/al-1/256.webp')),
}));

import { setupTrackChangeNotification } from './trackChangeNotification';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import type { TrackNotificationScheduler } from '@/features/playback/utils/notifications/trackNotificationScheduler';
import type { Track } from '@/lib/media/trackTypes';
import { resetPlayerStore } from '@/test/helpers/storeReset';

type Announced = Parameters<TrackNotificationScheduler['announce']>;

function fakeScheduler() {
  const calls: Announced[] = [];
  const scheduler: TrackNotificationScheduler = {
    announce: (...args) => { calls.push(args); },
    dispose: vi.fn(),
  };
  return { scheduler, calls };
}

function track(id: string): Track {
  return {
    id,
    title: `Song ${id}`,
    artist: 'Artist',
    album: 'Album',
    albumId: 'al-1',
    coverArt: 'al-1',
    duration: 281,
    serverId: 'srv',
  };
}

beforeEach(() => {
  resetPlayerStore();
});

describe('setupTrackChangeNotification', () => {
  it('does not announce the track restored at startup or a resume of it', () => {
    usePlayerStore.setState({ currentTrack: track('a'), isPlaying: false });
    const { scheduler, calls } = fakeScheduler();
    setupTrackChangeNotification(scheduler);

    usePlayerStore.setState({ isPlaying: true });

    expect(calls).toHaveLength(0);
  });

  it('announces a new track with its content and cover', async () => {
    const { scheduler, calls } = fakeScheduler();
    setupTrackChangeNotification(scheduler);

    usePlayerStore.setState({ currentTrack: track('b'), isPlaying: true });

    expect(calls).toHaveLength(1);
    const [key, build, isCurrent] = calls[0];
    expect(key).toBe('track:srv:b');
    await expect(build()).resolves.toEqual({
      title: 'Song b',
      body: 'Artist\nAlbum · 4:41',
      coverPath: '/cover-cache/al-1/256.webp',
    });
    expect(isCurrent()).toBe(true);

    usePlayerStore.setState({ isPlaying: false });
    expect(isCurrent()).toBe(false);
    usePlayerStore.setState({ isPlaying: true, currentTrack: track('c') });
    expect(isCurrent()).toBe(false);
  });

  it('leaves a radio session to the radio path', () => {
    const { scheduler, calls } = fakeScheduler();
    setupTrackChangeNotification(scheduler);

    usePlayerStore.setState({
      currentTrack: track('d'),
      currentRadio: { id: 'station', name: 'Station', streamUrl: 'https://radio.test/live' },
      isPlaying: true,
    });

    expect(calls).toHaveLength(0);
  });

  it('stops listening and cancels a pending notification on cleanup', () => {
    const { scheduler, calls } = fakeScheduler();
    const cleanup = setupTrackChangeNotification(scheduler);

    cleanup();
    usePlayerStore.setState({ currentTrack: track('e'), isPlaying: true });

    expect(calls).toHaveLength(0);
    expect(scheduler.dispose).toHaveBeenCalledTimes(1);
  });
});
