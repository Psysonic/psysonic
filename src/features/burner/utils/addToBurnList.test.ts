import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/dom/toast', () => ({ showToast: vi.fn() }));
vi.mock('@/lib/i18n', () => ({
  default: { t: (key: string, vars?: Record<string, unknown>) => `${key}:${JSON.stringify(vars ?? {})}` },
}));

import { addSongsToBurnList, addTracksToBurnList, songToBurnTrack } from './addToBurnList';
import { useBurnListStore } from '@/features/burner/store/burnListStore';

function song(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Track ${id}`,
    artist: 'Artist',
    album: 'Album',
    duration: 200,
    suffix: 'flac',
    size: 30_000_000,
    ...overrides,
  };
}

describe('songToBurnTrack', () => {
  it('carries the fields the fetch and plan both need', () => {
    const track = songToBurnTrack(song('a'), 'srv');
    expect(track).toMatchObject({
      key: 'srv:a',
      serverId: 'srv',
      trackId: 'a',
      title: 'Track a',
      durationSec: 200,
      suffix: 'flac',
      sizeBytes: 30_000_000,
    });
    // Not resolved yet — distinct from `null`, which means "not cached".
    expect(track.localPath).toBeUndefined();
  });
});

describe('addSongsToBurnList', () => {
  beforeEach(() => useBurnListStore.getState().clear());

  it('queues every song it is given', () => {
    addSongsToBurnList([song('a'), song('b'), song('c')], 'srv');
    expect(useBurnListStore.getState().tracks).toHaveLength(3);
  });

  it('does nothing for an empty list', () => {
    addSongsToBurnList([], 'srv');
    expect(useBurnListStore.getState().tracks).toHaveLength(0);
  });
});

describe('addTracksToBurnList', () => {
  beforeEach(() => useBurnListStore.getState().clear());

  it('queues a whole multi-selection, not just the first track', () => {
    // The reported bug: selecting all tracks in an album and choosing
    // "Add to CD" queued exactly one.
    const selection = Array.from({ length: 12 }, (_, i) => ({
      ...song(`t${i}`),
      serverId: 'srv',
    }));
    addTracksToBurnList(selection, 'srv');
    expect(useBurnListStore.getState().tracks).toHaveLength(12);
    expect(useBurnListStore.getState().tracks.map(t => t.trackId)).toEqual(
      selection.map(t => t.id),
    );
  });

  it('keeps each track with its own server across an aggregated selection', () => {
    addTracksToBurnList(
      [
        { ...song('a'), serverId: 'alpha' },
        { ...song('b'), serverId: 'beta' },
      ],
      'fallback',
    );
    const keys = useBurnListStore.getState().tracks.map(t => t.key);
    expect(keys).toEqual(['alpha:a', 'beta:b']);
  });

  it('falls back to the active server only for tracks that carry none', () => {
    addTracksToBurnList([{ ...song('a'), serverId: null }], 'fallback');
    expect(useBurnListStore.getState().tracks[0].serverId).toBe('fallback');
  });

  it('drops tracks with no resolvable server rather than queueing a broken row', () => {
    addTracksToBurnList([{ ...song('a'), serverId: null }], '');
    expect(useBurnListStore.getState().tracks).toHaveLength(0);
  });

  it('skips duplicates already on the disc', () => {
    addTracksToBurnList([{ ...song('a'), serverId: 'srv' }], 'srv');
    addTracksToBurnList(
      [{ ...song('a'), serverId: 'srv' }, { ...song('b'), serverId: 'srv' }],
      'srv',
    );
    expect(useBurnListStore.getState().tracks.map(t => t.trackId)).toEqual(['a', 'b']);
  });

  it('does nothing for an empty selection', () => {
    addTracksToBurnList([], 'srv');
    expect(useBurnListStore.getState().tracks).toHaveLength(0);
  });
});
