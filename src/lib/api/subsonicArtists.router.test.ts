import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/subsonicClient', () => ({
  api: vi.fn(),
  apiForServer: vi.fn(),
  libraryFilterParams: () => ({}),
  libraryFilterParamsForServer: () => ({}),
  librarySelectionForServer: () => [],
}));

vi.mock('@/lib/api/subsonicLibrary', () => ({
  filterSongsToActiveLibrary: async (songs: unknown[]) => songs,
  filterSongsToServerLibrary: async (songs: unknown[]) => songs,
  similarSongsRequestCount: (count: number) => count,
}));

import { apiForServer } from '@/lib/api/subsonicClient';
import {
  fetchSimilarTracksRouted,
  getSonicSimilarMatchesForServer,
  getSonicSimilarTracksForServer,
} from '@/lib/api/subsonicArtists';
import { useAuthStore } from '@/store/authStore';

const SID = 'srv-router';
const apiForServerMock = vi.mocked(apiForServer);

function seedServer(identity: Record<string, unknown>, probes: Record<string, unknown>) {
  useAuthStore.setState({
    activeServerId: SID,
    subsonicServerIdentityByServer: { [SID]: identity as never },
    audiomusePluginProbeByServer: {},
    instantMixProbeByServer: {},
    audiomuseNavidromeByServer: {},
    ...probes,
  } as never);
}

const SONIC_RESPONSE = { sonicMatch: [{ entry: { id: 'sonic-1', title: 'Sonic' } }] };
const SIMILAR_RESPONSE = { similarSongs: { song: [{ id: 'legacy-1', title: 'Legacy' }] } };

describe('fetchSimilarTracksRouted', () => {
  beforeEach(() => {
    apiForServerMock.mockReset();
  });

  it('prefers sonicSimilarity on Navidrome 0.62 with plugin', async () => {
    seedServer({ type: 'navidrome', serverVersion: '0.62.0', openSubsonic: true }, {
      audiomusePluginProbeByServer: { [SID]: 'present' },
    });
    apiForServerMock.mockImplementation(async (_serverId: string, endpoint: string) =>
      (endpoint === 'getSonicSimilarTracks.view' ? SONIC_RESPONSE : SIMILAR_RESPONSE) as never);

    const result = await fetchSimilarTracksRouted('seed', 10);
    expect(result.map(s => s.id)).toEqual(['sonic-1']);
    expect(apiForServerMock).toHaveBeenCalledWith(SID, 'getSonicSimilarTracks.view', expect.anything());
    expect(apiForServerMock).not.toHaveBeenCalledWith(SID, 'getSimilarSongs.view', expect.anything());
  });

  it('falls back to legacy when sonic returns empty', async () => {
    seedServer({ type: 'navidrome', serverVersion: '0.62.0', openSubsonic: true }, {
      audiomusePluginProbeByServer: { [SID]: 'present' },
    });
    apiForServerMock.mockImplementation(async (_serverId: string, endpoint: string) =>
      (endpoint === 'getSonicSimilarTracks.view' ? { sonicMatch: [] } : SIMILAR_RESPONSE) as never);

    const result = await fetchSimilarTracksRouted('seed', 10);
    expect(result.map(s => s.id)).toEqual(['legacy-1']);
    expect(apiForServerMock).toHaveBeenCalledWith(SID, 'getSonicSimilarTracks.view', expect.anything());
    expect(apiForServerMock).toHaveBeenCalledWith(SID, 'getSimilarSongs.view', expect.anything());
  });

  it('uses legacy only on Navidrome 0.62 without plugin', async () => {
    seedServer({ type: 'navidrome', serverVersion: '0.62.0', openSubsonic: true }, {
      audiomusePluginProbeByServer: { [SID]: 'absent' },
    });
    apiForServerMock.mockImplementation(async () => SIMILAR_RESPONSE as never);

    const result = await fetchSimilarTracksRouted('seed', 10);
    expect(result.map(s => s.id)).toEqual(['legacy-1']);
    expect(apiForServerMock).not.toHaveBeenCalledWith(SID, 'getSonicSimilarTracks.view', expect.anything());
    expect(apiForServerMock).toHaveBeenCalledWith(SID, 'getSimilarSongs.view', expect.anything());
  });
});

describe('getSonicSimilarMatchesForServer', () => {
  // Shape of a real `getSonicSimilarTracks` response (OpenSubsonic sonicSimilarity).
  const SCORED_RESPONSE = {
    sonicMatch: [
      { entry: { id: '300000060', title: 'BrownSmoke', albumId: '200000002', album: 'Colorsmoke EP' }, similarity: 0.95 },
      { entry: { id: '300000055', title: 'Red&GreenSmoke', albumId: '200000002', album: 'Colorsmoke EP' }, similarity: 0.88 },
      { entry: { id: 'no-score', title: 'No score' } },
    ],
  };

  beforeEach(() => {
    apiForServerMock.mockReset();
  });

  it('keeps each match\'s similarity score and tags the owning server', async () => {
    apiForServerMock.mockResolvedValue(SCORED_RESPONSE as never);
    const matches = await getSonicSimilarMatchesForServer(SID, 'seed', 10);
    expect(matches.map(m => [m.song.id, m.similarity, m.song.serverId])).toEqual([
      ['300000060', 0.95, SID],
      ['300000055', 0.88, SID],
      ['no-score', undefined, SID],
    ]);
  });

  it('accepts a single non-array sonicMatch', async () => {
    apiForServerMock.mockResolvedValue({ sonicMatch: SCORED_RESPONSE.sonicMatch[0] } as never);
    const matches = await getSonicSimilarMatchesForServer(SID, 'seed', 10);
    expect(matches).toHaveLength(1);
    expect(matches[0].similarity).toBe(0.95);
  });

  it('returns [] when the request fails', async () => {
    apiForServerMock.mockRejectedValue(new Error('404'));
    expect(await getSonicSimilarMatchesForServer(SID, 'seed', 10)).toEqual([]);
  });

  it('getSonicSimilarTracksForServer still returns plain songs', async () => {
    apiForServerMock.mockResolvedValue(SCORED_RESPONSE as never);
    const songs = await getSonicSimilarTracksForServer(SID, 'seed', 2);
    expect(songs.map(s => s.id)).toEqual(['300000060', '300000055']);
  });
});
