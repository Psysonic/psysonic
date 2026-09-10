import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/dom/toast', () => ({ showToast: vi.fn() }));
vi.mock('@/lib/i18n', () => ({
  default: { t: (key: string, vars?: Record<string, unknown>) => `${key}:${JSON.stringify(vars ?? {})}` },
}));

import { addSongsToBurnList, addTracksToBurnList, songToBurnTrack } from './addToBurnList';
import { showToast } from '@/lib/dom/toast';
import { useBurnListStore } from '@/features/burner/store/burnListStore';
import { useBurnJobStore } from '@/features/burner/store/burnJobStore';

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

/**
 * The queue is the running order of the *next* disc, and a job takes its copy
 * of it the moment it starts. Everything below is about that one fact: while a
 * job is running the queue may not move, and once it has settled the queue
 * belongs to the next disc again.
 */
describe('adding while a burn job exists', () => {
  /** The i18n mock spells a key out; this is the refusal, as the user sees it. */
  const REFUSAL = 'burner.toastBurnInProgress:{}';

  beforeEach(() => {
    useBurnListStore.getState().clear();
    useBurnJobStore.getState().reset();
    vi.mocked(showToast).mockClear();
  });

  // The job store is a module singleton and nothing else in this file resets it.
  afterEach(() => useBurnJobStore.getState().reset());

  function startJob(): void {
    useBurnJobStore.getState().start('job-1', 100_000, false);
  }

  it('queues nothing while the burn is running, and says why', () => {
    startJob();
    addSongsToBurnList([song('a')], 'srv');

    expect(useBurnListStore.getState().tracks).toHaveLength(0);
    expect(vi.mocked(showToast).mock.calls[0][0]).toBe(REFUSAL);
  });

  it('queues nothing from a multi-selection while the burn is running', () => {
    // The album / playlist / multi-select path is a different function and was
    // the one the user could still reach from another page mid-burn.
    startJob();
    addTracksToBurnList([{ ...song('a'), serverId: 'srv' }], 'srv');

    expect(useBurnListStore.getState().tracks).toHaveLength(0);
    expect(vi.mocked(showToast).mock.calls[0][0]).toBe(REFUSAL);
  });

  it('queues nothing while the burn is cancelling', () => {
    // Still the drive's queue: the cancel has been asked for, not finished.
    startJob();
    useBurnJobStore.getState().requestCancel();
    expect(useBurnJobStore.getState().status).toBe('cancelling');

    addSongsToBurnList([song('a')], 'srv');
    addTracksToBurnList([{ ...song('b'), serverId: 'srv' }], 'srv');

    expect(useBurnListStore.getState().tracks).toHaveLength(0);
    expect(vi.mocked(showToast).mock.calls[0][0]).toBe(REFUSAL);
  });

  it('resets a finished job and appends, rather than growing the disc just burned', () => {
    addSongsToBurnList([song('a')], 'srv');
    startJob();
    useBurnJobStore.getState().finish({ tracksWritten: 1, sectorsWritten: 100_000 });
    expect(useBurnJobStore.getState().status).toBe('done');

    addSongsToBurnList([song('b')], 'srv');

    // Same path "Burn another" takes: the page goes back to building.
    expect(useBurnJobStore.getState().status).toBe('idle');
    expect(useBurnJobStore.getState().jobId).toBeNull();
    // And the queue is kept, not cleared — Clear is right there if that is what
    // the user meant.
    expect(useBurnListStore.getState().tracks.map(t => t.trackId)).toEqual(['a', 'b']);
    const said = vi.mocked(showToast).mock.calls.map(call => call[0]);
    expect(said).not.toContain(REFUSAL);
  });

  it('resets a failed or cancelled job too — all three are just "that disc is done"', () => {
    for (const settle of [
      () => useBurnJobStore.getState().fail('drive said no'),
      () => useBurnJobStore.getState().finishCancelled(),
    ]) {
      useBurnListStore.getState().clear();
      useBurnJobStore.getState().reset();
      startJob();
      settle();

      addTracksToBurnList([{ ...song('a'), serverId: 'srv' }], 'srv');

      expect(useBurnJobStore.getState().status).toBe('idle');
      expect(useBurnJobStore.getState().error).toBeNull();
      expect(useBurnListStore.getState().tracks.map(t => t.trackId)).toEqual(['a']);
    }
  });

  it('leaves an idle job alone and queues as it always did', () => {
    addSongsToBurnList([song('a'), song('b')], 'srv');

    expect(useBurnListStore.getState().tracks).toHaveLength(2);
    expect(useBurnJobStore.getState().status).toBe('idle');
    expect(vi.mocked(showToast).mock.calls[0][0]).toBe('burner.toastAdded:{"count":2}');
  });
});
