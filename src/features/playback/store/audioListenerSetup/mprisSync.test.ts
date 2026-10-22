import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  mprisSetMetadata: vi.fn(() => Promise.resolve()),
  mprisSetPlayback: vi.fn(() => Promise.resolve()),
  mprisSetVolume: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/api/mpris', () => ({
  mprisSetMetadata: hoisted.mprisSetMetadata,
  mprisSetPlayback: hoisted.mprisSetPlayback,
  mprisSetVolume: hoisted.mprisSetVolume,
}));
vi.mock('@/cover/resolveEntryLibrary', () => ({
  resolveTrackCoverRefFromLibrary: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('@/cover/integrations/mpris', () => ({
  coverArtUrlForMpris: vi.fn(() => Promise.resolve('')),
}));
vi.mock('@/features/playback/store/playbackProgress', () => ({
  getPlaybackProgressSnapshot: () => ({ currentTime: 0 }),
  subscribePlaybackProgress: () => () => {},
}));

import { setupMprisSync } from './mprisSync';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { resetPlayerStore } from '@/test/helpers/storeReset';
import { resolveTrackCoverRefFromLibrary } from '@/cover/resolveEntryLibrary';
import { coverArtUrlForMpris } from '@/cover/integrations/mpris';

describe('setupMprisSync radio ownership', () => {
  beforeEach(() => {
    resetPlayerStore();
    hoisted.mprisSetMetadata.mockClear();
    hoisted.mprisSetPlayback.mockClear();
    hoisted.mprisSetVolume.mockClear();
  });

  it('pushes metadata when radio ownership changes but the raw id is the same', () => {
    const cleanup = setupMprisSync();
    usePlayerStore.setState({
      currentRadio: {
        id: 'shared',
        serverId: 'srv-a',
        name: 'Alpha Radio',
        streamUrl: 'https://a.test/live',
      },
      isPlaying: true,
    });
    usePlayerStore.setState({
      currentRadio: {
        id: 'shared',
        serverId: 'srv-b',
        name: 'Beta Radio',
        streamUrl: 'https://b.test/live',
      },
      isPlaying: true,
    });

    expect(hoisted.mprisSetMetadata).toHaveBeenNthCalledWith(1, expect.objectContaining({
      title: 'Alpha Radio',
    }));
    expect(hoisted.mprisSetMetadata).toHaveBeenNthCalledWith(2, expect.objectContaining({
      title: 'Beta Radio',
    }));
    cleanup();
  });

  it('pushes the initial volume and subsequent changes', () => {
    usePlayerStore.setState({ volume: 0.35 });
    const cleanup = setupMprisSync();

    expect(hoisted.mprisSetVolume).toHaveBeenNthCalledWith(1, 0.35);

    usePlayerStore.setState({ volume: 0.7 });

    expect(hoisted.mprisSetVolume).toHaveBeenNthCalledWith(2, 0.7);
    cleanup();
  });
});

describe('setupMprisSync track metadata', () => {
  beforeEach(() => {
    resetPlayerStore();
    hoisted.mprisSetMetadata.mockClear();
  });

  it('drops a late cover for a track that is no longer playing', async () => {
    let releaseSlowCover: (url: string) => void = () => {};
    vi.mocked(resolveTrackCoverRefFromLibrary).mockImplementation(
      (async (track: { id: string }) => ({ id: track.id })) as never,
    );
    vi.mocked(coverArtUrlForMpris).mockImplementation((async (ref: { id: string }) => (
      ref.id === 'a'
        ? new Promise<string>(resolve => { releaseSlowCover = resolve; })
        : 'file:///b.webp'
    )) as never);

    const cleanup = setupMprisSync();
    const track = (id: string, title: string) => ({
      id, title, artist: 'Band', album: 'Record', albumId: `al-${id}`, coverArt: `c-${id}`, duration: 100,
    });
    usePlayerStore.setState({ currentTrack: track('a', 'Old') as never });
    usePlayerStore.setState({ currentTrack: track('b', 'New') as never });
    await vi.waitFor(() => expect(hoisted.mprisSetMetadata).toHaveBeenCalledTimes(1));
    releaseSlowCover('file:///a.webp');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(hoisted.mprisSetMetadata).toHaveBeenCalledTimes(1);
    expect(hoisted.mprisSetMetadata).toHaveBeenCalledWith(expect.objectContaining({ title: 'New' }));
    cleanup();
  });
});
