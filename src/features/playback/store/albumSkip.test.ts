import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTrack, seedQueue } from '@/test/helpers/factories';
import { resetAllStores } from '@/test/helpers/storeReset';
import type { Track } from '@/lib/media/trackTypes';
import { usePlayerStore } from './playerStore';
import { emitPlaybackProgress } from './playbackProgress';
import { skipToNextAlbum, skipToPreviousAlbum } from './albumSkip';
import {
  nextQueueAlbumStart,
  queueAlbumStart,
  sameQueueAlbum,
} from '@/features/playback/utils/playback/queueAlbum';

const playTrack = vi.fn();
const previous = vi.fn();

/** A, A, A, B, B, C — three album runs in queue order. */
function queue(): Track[] {
  return [
    makeTrack({ albumId: 'a' }),
    makeTrack({ albumId: 'a' }),
    makeTrack({ albumId: 'a' }),
    makeTrack({ albumId: 'b' }),
    makeTrack({ albumId: 'b' }),
    makeTrack({ albumId: 'c' }),
  ];
}

function at(index: number, currentTime = 0): Track[] {
  const tracks = queue();
  seedQueue(tracks, { index, serverId: 'srv' });
  usePlayerStore.setState({ isPlaying: true, playTrack, previous });
  emitPlaybackProgress({ currentTime, progress: 0, buffered: 0, buffering: false });
  return tracks;
}

function jumpedTo(): number | undefined {
  return playTrack.mock.calls[0]?.[4];
}

beforeEach(() => {
  resetAllStores();
  playTrack.mockClear();
  previous.mockClear();
});

describe('queue album helpers', () => {
  it('treats the same album id on the same server as one album, and a missing id as none', () => {
    const a = makeTrack({ albumId: 'x', serverId: 's1' });
    expect(sameQueueAlbum(a, undefined, makeTrack({ albumId: 'x', serverId: 's1' }), undefined)).toBe(true);
    expect(sameQueueAlbum(a, undefined, makeTrack({ albumId: 'x', serverId: 's2' }), undefined)).toBe(false);
    expect(sameQueueAlbum(makeTrack({ albumId: '' }), undefined, makeTrack({ albumId: '' }), undefined)).toBe(false);
  });

  it('finds where an album run starts and where the next one begins', () => {
    at(4);
    const { queueItems } = usePlayerStore.getState();
    expect(queueAlbumStart(queueItems, 2)).toBe(0);
    expect(queueAlbumStart(queueItems, 4)).toBe(3);
    expect(nextQueueAlbumStart(queueItems, 0)).toBe(3);
    expect(nextQueueAlbumStart(queueItems, 3)).toBe(5);
    expect(nextQueueAlbumStart(queueItems, 5)).toBeNull();
  });
});

describe('skipToNextAlbum', () => {
  it('jumps to the first track of the next album', () => {
    const tracks = at(1);
    skipToNextAlbum();
    expect(jumpedTo()).toBe(3);
    expect(playTrack.mock.calls[0][0].id).toBe(tracks[3].id);
  });

  it('does nothing when no other album follows, or while radio plays', () => {
    at(5);
    skipToNextAlbum();
    at(0);
    usePlayerStore.setState({ currentRadio: { id: 'r', name: 'r', streamUrl: 'http://x' } as never });
    skipToNextAlbum();
    expect(playTrack).not.toHaveBeenCalled();
  });
});

describe('skipToPreviousAlbum', () => {
  it('goes back to the start of the current album first', () => {
    at(2, 1);
    skipToPreviousAlbum();
    expect(jumpedTo()).toBe(0);
  });

  it('restarts the first track of the album when it has been playing for a while', () => {
    at(3, 40);
    skipToPreviousAlbum();
    expect(previous).toHaveBeenCalledOnce();
    expect(playTrack).not.toHaveBeenCalled();
  });

  it('goes to the previous album from the start of the current one', () => {
    at(3, 1);
    skipToPreviousAlbum();
    expect(jumpedTo()).toBe(0);
  });

  it('does nothing at the start of the first album', () => {
    at(0, 1);
    skipToPreviousAlbum();
    expect(playTrack).not.toHaveBeenCalled();
    expect(previous).not.toHaveBeenCalled();
  });
});
