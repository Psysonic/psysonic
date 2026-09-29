import { beforeEach, describe, expect, it } from 'vitest';
import { useBurnListStore } from './burnListStore';
import { MAX_TRACKS, type BurnQueueTrack } from '@/features/burner/utils/capacity';

function track(id: string): BurnQueueTrack {
  return {
    key: `srv:${id}`,
    serverId: 'srv',
    trackId: id,
    title: `Track ${id}`,
    artist: 'Artist',
    album: 'Album',
    durationSec: 200,
  };
}

describe('burnListStore', () => {
  beforeEach(() => {
    useBurnListStore.getState().clear();
  });

  it('adds tracks and reports how many landed', () => {
    expect(useBurnListStore.getState().add([track('a'), track('b')])).toBe(2);
    expect(useBurnListStore.getState().tracks).toHaveLength(2);
  });

  it('skips tracks already queued and reports the real count', () => {
    useBurnListStore.getState().add([track('a')]);
    expect(useBurnListStore.getState().add([track('a'), track('b')])).toBe(1);
    expect(useBurnListStore.getState().tracks.map(t => t.trackId)).toEqual(['a', 'b']);
  });

  it('returns zero when everything was already queued', () => {
    useBurnListStore.getState().add([track('a')]);
    expect(useBurnListStore.getState().add([track('a')])).toBe(0);
  });

  it('stops at the 99-track ceiling instead of overfilling the disc', () => {
    const many = Array.from({ length: 120 }, (_, i) => track(`t${i}`));
    expect(useBurnListStore.getState().add(many)).toBe(MAX_TRACKS);
    expect(useBurnListStore.getState().tracks).toHaveLength(MAX_TRACKS);

    // A full list accepts nothing more.
    expect(useBurnListStore.getState().add([track('extra')])).toBe(0);
  });

  it('removes by key', () => {
    useBurnListStore.getState().add([track('a'), track('b')]);
    useBurnListStore.getState().remove('srv:a');
    expect(useBurnListStore.getState().tracks.map(t => t.trackId)).toEqual(['b']);
  });

  it('moves a track down the running order', () => {
    useBurnListStore.getState().add([track('a'), track('b'), track('c')]);
    useBurnListStore.getState().move(0, 2);
    expect(useBurnListStore.getState().tracks.map(t => t.trackId)).toEqual(['b', 'c', 'a']);
  });

  it('moves a track up the running order', () => {
    useBurnListStore.getState().add([track('a'), track('b'), track('c')]);
    useBurnListStore.getState().move(2, 0);
    expect(useBurnListStore.getState().tracks.map(t => t.trackId)).toEqual(['c', 'a', 'b']);
  });

  it('ignores out-of-range and no-op moves rather than corrupting the list', () => {
    useBurnListStore.getState().add([track('a'), track('b')]);
    const before = useBurnListStore.getState().tracks;
    useBurnListStore.getState().move(0, 0);
    useBurnListStore.getState().move(-1, 1);
    useBurnListStore.getState().move(0, 9);
    expect(useBurnListStore.getState().tracks).toEqual(before);
  });

  it('drags a track down onto the far side of another row', () => {
    useBurnListStore.getState().add([track('a'), track('b'), track('c')]);
    useBurnListStore.getState().reorder('srv:a', { id: 'srv:c', before: false });
    expect(useBurnListStore.getState().tracks.map(t => t.trackId)).toEqual(['b', 'c', 'a']);
  });

  it('drags a track up onto the near side of another row', () => {
    useBurnListStore.getState().add([track('a'), track('b'), track('c')]);
    useBurnListStore.getState().reorder('srv:c', { id: 'srv:a', before: true });
    expect(useBurnListStore.getState().tracks.map(t => t.trackId)).toEqual(['c', 'a', 'b']);
  });

  it('ignores a drop onto the row being dragged', () => {
    useBurnListStore.getState().add([track('a'), track('b')]);
    const before = useBurnListStore.getState().tracks;
    useBurnListStore.getState().reorder('srv:a', { id: 'srv:a', before: true });
    expect(useBurnListStore.getState().tracks).toEqual(before);
  });

  it('ignores a no-op edge that would not change the order', () => {
    useBurnListStore.getState().add([track('a'), track('b')]);
    const before = useBurnListStore.getState().tracks;
    // Dropping 'a' just above 'b' is where it already is.
    useBurnListStore.getState().reorder('srv:a', { id: 'srv:b', before: true });
    expect(useBurnListStore.getState().tracks).toEqual(before);
  });

  it('ignores an unknown dragged key rather than dropping tracks', () => {
    useBurnListStore.getState().add([track('a'), track('b')]);
    useBurnListStore.getState().reorder('srv:ghost', { id: 'srv:a', before: true });
    expect(useBurnListStore.getState().tracks).toHaveLength(2);
  });

  it('ignores an unknown drop target', () => {
    useBurnListStore.getState().add([track('a'), track('b')]);
    const before = useBurnListStore.getState().tracks;
    useBurnListStore.getState().reorder('srv:a', { id: 'srv:ghost', before: true });
    expect(useBurnListStore.getState().tracks).toEqual(before);
  });

  it('never loses or duplicates a track when reordering', () => {
    const many = Array.from({ length: 12 }, (_, i) => track(`t${i}`));
    useBurnListStore.getState().add(many);
    useBurnListStore.getState().reorder('srv:t0', { id: 'srv:t11', before: false });
    useBurnListStore.getState().reorder('srv:t5', { id: 'srv:t1', before: true });
    const ids = useBurnListStore.getState().tracks.map(t => t.trackId);
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
  });

  it('keeps resolved local paths across a reorder', () => {
    useBurnListStore.getState().add([track('a'), track('b')]);
    useBurnListStore.getState().setLocalPaths({ 'srv:a': '/music/a.flac' });
    useBurnListStore.getState().reorder('srv:a', { id: 'srv:b', before: false });
    const moved = useBurnListStore.getState().tracks.find(t => t.trackId === 'a');
    expect(moved?.localPath).toBe('/music/a.flac');
  });

  it('applies resolved local paths only to the keys it was given', () => {
    useBurnListStore.getState().add([track('a'), track('b')]);
    useBurnListStore.getState().setLocalPaths({ 'srv:a': '/music/a.flac' });
    const [a, b] = useBurnListStore.getState().tracks;
    expect(a.localPath).toBe('/music/a.flac');
    expect(b.localPath).toBeUndefined();
  });

  it('records a missing file as null so the UI can flag it', () => {
    useBurnListStore.getState().add([track('a')]);
    useBurnListStore.getState().setLocalPaths({ 'srv:a': null });
    expect(useBurnListStore.getState().tracks[0].localPath).toBeNull();
  });

  it('clears the queue and the disc title together', () => {
    useBurnListStore.getState().add([track('a')]);
    useBurnListStore.getState().setDiscTitle('Mixtape');
    useBurnListStore.getState().clear();
    expect(useBurnListStore.getState().tracks).toHaveLength(0);
    expect(useBurnListStore.getState().discTitle).toBe('');
  });
});
