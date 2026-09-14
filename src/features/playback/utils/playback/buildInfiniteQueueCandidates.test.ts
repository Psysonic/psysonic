/**
 * Characterization for `buildInfiniteQueueCandidates` (Instant-Mix-style
 * top-up source for the infinite queue).
 *
 * Originally lived in `playerStore.ts`; extracted in M0 of the frontend
 * refactor (2026-05-12). This test pins the artist-first / random-fallback
 * order, the dedup contract against existingIds, and the autoAdded flag.
 */
import {
  getSimilarSongs2ForServer,
  getTopSongsForServer,
} from '@/lib/api/subsonicArtists';
import { getRandomSongsForServer } from '@/lib/api/subsonicLibrary';
import type { Track } from '@/lib/media/trackTypes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock only the artist Subsonic API submodule (the pre-move target was
// `api/subsonicArtists`); the barrel re-exports it, so consumers still get the
// stubs while `coerceOpenArtistRefs` (used by songToTrack) stays real.
vi.mock('@/lib/api/subsonicArtists', () => ({
  getSimilarSongs2ForServer: vi.fn(),
  getTopSongsForServer: vi.fn(),
}));

vi.mock('@/lib/api/subsonicLibrary', () => ({
  getRandomSongsForServer: vi.fn(),
}));

vi.mock('@/features/playback/utils/mixRatingFilter', () => ({
  getMixMinRatingsConfigFromAuth: vi.fn(),
  enrichSongsForMixRatingFilter: vi.fn(),
  passesMixMinRatings: vi.fn(),
}));

import { buildInfiniteQueueCandidates } from '@/features/playback/utils/playback/buildInfiniteQueueCandidates';
import {
  enrichSongsForMixRatingFilter,
  getMixMinRatingsConfigFromAuth,
} from '@/features/playback/utils/mixRatingFilter';
import { makeSubsonicSong } from '@/test/helpers/factories';
import { queueTrackIdentityKey } from '@/features/playback/utils/playback/queueIdentity';
import type { LibraryBrowseScope } from '@/lib/library/libraryBrowseScope';

const { getLibraryBrowseScopeMock } = vi.hoisted(() => ({
  getLibraryBrowseScopeMock: vi.fn<() => LibraryBrowseScope>(() => ({
    anchorServerId: null,
    serverIds: [],
    pairs: [],
    fingerprint: '',
    multiServer: false,
  })),
}));

vi.mock('@/lib/library/libraryBrowseScope', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/library/libraryBrowseScope')>(),
  getLibraryBrowseScope: getLibraryBrowseScopeMock,
}));

const SERVER_ID = 'server-a';

const seed = (overrides: Partial<Track> = {}): Track => ({
  id: 'seed',
  title: 'Seed',
  artist: 'Artist A',
  album: 'Album A',
  albumId: 'al-A',
  artistId: 'ar-A',
  duration: 180,
  genre: 'Rock',
  ...overrides,
});

function buildCandidates(
  seedTrack: Track | null,
  existingIds: string[] = [],
  count = 5,
  serverId = SERVER_ID,
): Promise<Track[]> {
  const existingIdentities = new Set(
    existingIds.map(id => queueTrackIdentityKey(id, serverId)),
  );
  return buildInfiniteQueueCandidates(seedTrack, serverId, existingIdentities, count);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default mocks — individual tests override as needed. The random-topup loop
  // calls getRandomSongs unconditionally when artist sources don't fill `count`,
  // so a default empty resolution avoids "Cannot read properties of undefined".
  vi.mocked(getSimilarSongs2ForServer).mockResolvedValue([]);
  vi.mocked(getTopSongsForServer).mockResolvedValue([]);
  vi.mocked(getRandomSongsForServer).mockResolvedValue([]);
  getLibraryBrowseScopeMock.mockReturnValue({
    anchorServerId: null,
    serverIds: [],
    pairs: [],
    fingerprint: '',
    multiServer: false,
  });
  // Default: filter disabled — the function then short-circuits the enrich path.
  vi.mocked(getMixMinRatingsConfigFromAuth).mockReturnValue({
    enabled: false,
    minSong: 0,
    minAlbum: 0,
    minArtist: 0,
  });
  // Deterministic shuffle: Math.random()=0 collapses Fisher-Yates to a known order.
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildInfiniteQueueCandidates', () => {
  it('asks for similar + top in parallel when seedTrack has artistId + artist', async () => {
    vi.mocked(getSimilarSongs2ForServer).mockResolvedValue([makeSubsonicSong({ id: 'sim-1' })]);
    vi.mocked(getTopSongsForServer).mockResolvedValue([makeSubsonicSong({ id: 'top-1' })]);

    await buildCandidates(seed());

    expect(getSimilarSongs2ForServer).toHaveBeenCalledWith(SERVER_ID, 'ar-A');
    expect(getTopSongsForServer).toHaveBeenCalledWith(SERVER_ID, 'Artist A');
  });

  it('uses the selected browse libraries for every infinite-queue source', async () => {
    getLibraryBrowseScopeMock.mockReturnValue({
      anchorServerId: SERVER_ID,
      serverIds: [SERVER_ID],
      pairs: [{ serverId: SERVER_ID, libraryId: 'music' }],
      fingerprint: 'music',
      multiServer: false,
    });
    vi.mocked(getSimilarSongs2ForServer).mockResolvedValue([]);
    vi.mocked(getTopSongsForServer).mockResolvedValue([]);
    vi.mocked(getRandomSongsForServer).mockResolvedValue([]);

    await buildCandidates(seed());

    expect(getSimilarSongs2ForServer).toHaveBeenCalledWith(SERVER_ID, 'ar-A', 50, ['music']);
    expect(getTopSongsForServer).toHaveBeenCalledWith(SERVER_ID, 'Artist A', {
      libraryIds: ['music'],
    });
    expect(getRandomSongsForServer).toHaveBeenCalledWith(
      SERVER_ID,
      expect.any(Number),
      'Rock',
      15000,
      ['music'],
    );
  });

  it('skips similar when artistId is missing', async () => {
    vi.mocked(getSimilarSongs2ForServer).mockResolvedValue([]);
    vi.mocked(getTopSongsForServer).mockResolvedValue([makeSubsonicSong({ id: 'top-1' })]);

    await buildCandidates(seed({ artistId: undefined }));

    expect(getSimilarSongs2ForServer).not.toHaveBeenCalled();
    expect(getTopSongsForServer).toHaveBeenCalledWith(SERVER_ID, 'Artist A');
  });

  it('skips top when artist name is missing', async () => {
    vi.mocked(getSimilarSongs2ForServer).mockResolvedValue([makeSubsonicSong({ id: 'sim-1' })]);
    vi.mocked(getTopSongsForServer).mockResolvedValue([]);

    await buildCandidates(seed({ artist: '' }));

    expect(getSimilarSongs2ForServer).toHaveBeenCalledWith(SERVER_ID, 'ar-A');
    expect(getTopSongsForServer).not.toHaveBeenCalled();
  });

  it('skips both when seedTrack is null', async () => {
    vi.mocked(getRandomSongsForServer).mockResolvedValue([]);

    await buildCandidates(null);

    expect(getSimilarSongs2ForServer).not.toHaveBeenCalled();
    expect(getTopSongsForServer).not.toHaveBeenCalled();
  });

  it('marks every returned candidate with autoAdded=true', async () => {
    vi.mocked(getSimilarSongs2ForServer).mockResolvedValue([
      makeSubsonicSong({ id: 'sim-1' }),
      makeSubsonicSong({ id: 'sim-2' }),
    ]);
    vi.mocked(getTopSongsForServer).mockResolvedValue([makeSubsonicSong({ id: 'top-1' })]);
    vi.mocked(getRandomSongsForServer).mockResolvedValue([]);

    const out = await buildCandidates(seed());

    expect(out.length).toBeGreaterThan(0);
    for (const t of out) expect(t.autoAdded).toBe(true);
  });

  it('excludes the seedTrack id and existingIds from the result', async () => {
    vi.mocked(getSimilarSongs2ForServer).mockResolvedValue([
      makeSubsonicSong({ id: 'seed' }), // self → excluded
      makeSubsonicSong({ id: 'already-in-queue' }), // in existingIds → excluded
      makeSubsonicSong({ id: 'fresh-1' }),
    ]);
    vi.mocked(getTopSongsForServer).mockResolvedValue([]);
    vi.mocked(getRandomSongsForServer).mockResolvedValue([]);

    const out = await buildCandidates(seed(), ['already-in-queue']);

    const ids = out.map(t => t.id);
    expect(ids).toContain('fresh-1');
    expect(ids).not.toContain('seed');
    expect(ids).not.toContain('already-in-queue');
  });

  it('falls back to getRandomSongs when artist sources are empty', async () => {
    vi.mocked(getSimilarSongs2ForServer).mockResolvedValue([]);
    vi.mocked(getTopSongsForServer).mockResolvedValue([]);
    vi.mocked(getRandomSongsForServer).mockResolvedValue([
      makeSubsonicSong({ id: 'rnd-1' }),
      makeSubsonicSong({ id: 'rnd-2' }),
      makeSubsonicSong({ id: 'rnd-3' }),
    ]);

    const out = await buildCandidates(seed(), [], 3);

    expect(getRandomSongsForServer).toHaveBeenCalled();
    expect(out.map(t => t.id).sort()).toEqual(['rnd-1', 'rnd-2', 'rnd-3']);
  });

  it('passes the seed track genre to getRandomSongs', async () => {
    vi.mocked(getSimilarSongs2ForServer).mockResolvedValue([]);
    vi.mocked(getTopSongsForServer).mockResolvedValue([]);
    vi.mocked(getRandomSongsForServer).mockResolvedValue([makeSubsonicSong({ id: 'rnd-1' })]);

    await buildCandidates(seed({ genre: 'Jazz' }), [], 1);

    expect(getRandomSongsForServer).toHaveBeenCalledWith(SERVER_ID, expect.any(Number), 'Jazz');
  });

  it('stops after up to 8 random batches when supply is exhausted', async () => {
    vi.mocked(getSimilarSongs2ForServer).mockResolvedValue([]);
    vi.mocked(getTopSongsForServer).mockResolvedValue([]);
    // Each batch returns one same song that's already counted → no progress.
    vi.mocked(getRandomSongsForServer).mockResolvedValue([makeSubsonicSong({ id: 'dup' })]);

    await buildCandidates(seed(), ['dup']);

    // Cap is 8 batches.
    expect(vi.mocked(getRandomSongsForServer).mock.calls.length).toBeLessThanOrEqual(8);
  });

  it('breaks the random loop early when getRandomSongs returns an empty batch', async () => {
    vi.mocked(getSimilarSongs2ForServer).mockResolvedValue([]);
    vi.mocked(getTopSongsForServer).mockResolvedValue([]);
    vi.mocked(getRandomSongsForServer).mockResolvedValue([]);

    await buildCandidates(seed());

    // First batch is empty → loop breaks immediately, no second call.
    expect(vi.mocked(getRandomSongsForServer).mock.calls.length).toBe(1);
  });

  it('survives a rejected getSimilarSongs2 call (catches and treats as empty)', async () => {
    vi.mocked(getSimilarSongs2ForServer).mockRejectedValue(new Error('boom'));
    vi.mocked(getTopSongsForServer).mockResolvedValue([makeSubsonicSong({ id: 'top-1' })]);
    vi.mocked(getRandomSongsForServer).mockResolvedValue([]);

    const out = await buildCandidates(seed());

    expect(out.map(t => t.id)).toContain('top-1');
  });

  it('survives a rejected getTopSongs call (catches and treats as empty)', async () => {
    vi.mocked(getSimilarSongs2ForServer).mockResolvedValue([makeSubsonicSong({ id: 'sim-1' })]);
    vi.mocked(getTopSongsForServer).mockRejectedValue(new Error('boom'));
    vi.mocked(getRandomSongsForServer).mockResolvedValue([]);

    const out = await buildCandidates(seed());

    expect(out.map(t => t.id)).toContain('sim-1');
  });

  it('returns at most `count` items even when sources oversupply', async () => {
    vi.mocked(getSimilarSongs2ForServer).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => makeSubsonicSong({ id: `sim-${i}` })),
    );
    vi.mocked(getTopSongsForServer).mockResolvedValue([]);
    vi.mocked(getRandomSongsForServer).mockResolvedValue([]);

    const out = await buildCandidates(seed(), [], 3);

    expect(out).toHaveLength(3);
  });

  it('runs the rating-filter enrichment pipeline when filter is enabled', async () => {
    vi.mocked(getMixMinRatingsConfigFromAuth).mockReturnValue({
      enabled: true,
      minSong: 3,
      minAlbum: 0,
      minArtist: 0,
    });
    vi.mocked(enrichSongsForMixRatingFilter).mockResolvedValue([
      makeSubsonicSong({ id: 'sim-1' }),
    ]);
    vi.mocked(getSimilarSongs2ForServer).mockResolvedValue([makeSubsonicSong({ id: 'sim-1' })]);
    vi.mocked(getTopSongsForServer).mockResolvedValue([]);
    vi.mocked(getRandomSongsForServer).mockResolvedValue([]);

    await buildCandidates(seed());

    expect(enrichSongsForMixRatingFilter).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      SERVER_ID,
    );
  });

  it('returns an empty array when nothing usable is found', async () => {
    vi.mocked(getSimilarSongs2ForServer).mockResolvedValue([]);
    vi.mocked(getTopSongsForServer).mockResolvedValue([]);
    vi.mocked(getRandomSongsForServer).mockResolvedValue([]);

    const out = await buildCandidates(seed());

    expect(out).toEqual([]);
  });

  it('stamps candidates with the requested owner and ignores same ids from other owners', async () => {
    vi.mocked(getSimilarSongs2ForServer).mockResolvedValue([
      makeSubsonicSong({ id: 'shared', serverId: undefined }),
    ]);

    const otherOwnerIdentity = queueTrackIdentityKey('shared', 'server-b');
    const out = await buildInfiniteQueueCandidates(
      seed(),
      SERVER_ID,
      new Set([otherOwnerIdentity]),
      1,
    );

    expect(out).toEqual([
      expect.objectContaining({ id: 'shared', serverId: SERVER_ID, autoAdded: true }),
    ]);
  });
});
