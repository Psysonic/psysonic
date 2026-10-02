import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  libraryListTracksByMood: vi.fn(),
  readyLibraryServerKeys: vi.fn(),
}));

vi.mock('@/lib/api/library', () => ({
  libraryListTracksByMood: hoisted.libraryListTracksByMood,
}));

vi.mock('@/lib/api/subsonicClient', () => ({
  libraryScopeForServer: vi.fn(() => null),
  libraryScopePairsForServer: vi.fn(() => []),
}));

vi.mock('./libraryReady', () => ({
  readyLibraryServerKeys: hoisted.readyLibraryServerKeys,
}));

vi.mock('./trackDtoMapping', () => ({
  trackToSong: (track: unknown) => track,
}));

import { fetchMoodTrackPage } from './moodTrackBrowse';

describe('fetchMoodTrackPage', () => {
  beforeEach(() => {
    hoisted.libraryListTracksByMood.mockReset();
    hoisted.readyLibraryServerKeys.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a temporary library readiness failure before browsing', async () => {
    vi.useFakeTimers();
    hoisted.readyLibraryServerKeys
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(['srv-1']);
    hoisted.libraryListTracksByMood.mockResolvedValueOnce({
      tracks: [{ id: 'track-1', title: 'Track 1' }],
      hasMore: false,
      total: 1,
      source: 'local',
    });

    const request = fetchMoodTrackPage(
      'srv-1',
      'Dreamy',
      true,
      0,
      100,
      undefined,
      true,
    );

    await vi.runAllTimersAsync();
    const result = await request;

    expect(hoisted.readyLibraryServerKeys).toHaveBeenCalledTimes(2);
    expect(hoisted.libraryListTracksByMood).toHaveBeenCalledTimes(1);
    expect(result?.songs).toHaveLength(1);
    expect(result?.total).toBe(1);
  });
});