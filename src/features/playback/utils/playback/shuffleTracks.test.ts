import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@/store/authStore';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { makeTrack } from '@/test/helpers/factories';
import type { QueueItemRef, Track } from '@/lib/media/trackTypes';
import {
  shuffleQueueRefs,
  shuffleTracks,
  trackShuffleKeys,
} from '@/features/playback/utils/playback/shuffleTracks';

/** Four artists with five tracks each, listed artist by artist. */
function groupedList(): Track[] {
  const tracks: Track[] = [];
  for (let a = 0; a < 4; a++) {
    for (let t = 0; t < 5; t++) {
      tracks.push(makeTrack({ id: `a${a}-t${t}`, artist: `Artist ${a}`, albumId: `al-${a}`, serverId: 'srv' }));
    }
  }
  return tracks;
}

function sameArtistNeighbours(tracks: Track[]): number {
  let count = 0;
  for (let i = 1; i < tracks.length; i++) if (tracks[i].artist === tracks[i - 1].artist) count++;
  return count;
}

function averageNeighbours(shuffle: () => Track[], runs = 100): number {
  let total = 0;
  for (let run = 0; run < runs; run++) total += sameArtistNeighbours(shuffle());
  return total / runs;
}

beforeEach(() => {
  resetAuthStore();
});

describe('trackShuffleKeys', () => {
  it('groups by the primary performer, ignoring case and surrounding space', () => {
    const credited = makeTrack({ artist: 'Lead feat. Guest', artists: [{ id: 'x', name: ' Lead ' }] });
    const plain = makeTrack({ artist: 'LEAD' });
    expect(trackShuffleKeys(credited)?.primary).toBe('lead');
    expect(trackShuffleKeys(plain)?.primary).toBe('lead');
  });

  it('tells apart albums with the same id on two servers', () => {
    const a = trackShuffleKeys(makeTrack({ albumId: 'al-1', serverId: 'srv-a' }));
    const b = trackShuffleKeys(makeTrack({ albumId: 'al-1', serverId: 'srv-b' }));
    expect(a?.secondary).not.toBe(b?.secondary);
  });

  it('returns no keys for a track without artist or album', () => {
    expect(trackShuffleKeys(makeTrack({ artist: '', album: '', albumId: '' }))).toBeNull();
  });
});

describe('shuffleTracks', () => {
  it('is on by default and spreads each artist over the list', () => {
    expect(useAuthStore.getState().smartShuffleEnabled).toBe(true);
    const list = groupedList();
    expect(averageNeighbours(() => shuffleTracks(list))).toBeLessThan(0.3);
  });

  it('falls back to plain random order when switched off', () => {
    useAuthStore.getState().setSmartShuffleEnabled(false);
    const list = groupedList();
    // About four same-artist neighbours per shuffle is what pure chance gives here.
    expect(averageNeighbours(() => shuffleTracks(list))).toBeGreaterThan(3);
  });

  it('keeps every track exactly once', () => {
    const list = groupedList();
    const out = shuffleTracks(list);
    expect(out.map(t => t.id).sort()).toEqual(list.map(t => t.id).sort());
  });
});

describe('shuffleQueueRefs', () => {
  const list = groupedList();
  const refs: QueueItemRef[] = list.map(t => ({ serverId: 'srv', trackId: t.id }));
  const byId = new Map(list.map(t => [t.id, t]));
  const byRef = (items: QueueItemRef[]) => items.map(ref => byId.get(ref.trackId)!);

  it('spreads artists using the tracks the lookup knows', () => {
    const avg = averageNeighbours(() => byRef(shuffleQueueRefs(refs, ref => byId.get(ref.trackId))));
    expect(avg).toBeLessThan(0.3);
  });

  it('still mixes refs the lookup cannot resolve, and loses none', () => {
    const out = shuffleQueueRefs(refs, () => undefined);
    expect(out).toHaveLength(refs.length);
    expect(out.map(r => r.trackId).sort()).toEqual(refs.map(r => r.trackId).sort());
  });
});
