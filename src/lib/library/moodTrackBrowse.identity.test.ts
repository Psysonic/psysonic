import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/lib/api/library', () => ({ libraryListTracksByMood: mocks.list }));
vi.mock('@/lib/api/subsonicClient', () => ({
  libraryScopeForServer: () => null,
  libraryScopePairsForServer: () => [],
}));
vi.mock('./libraryReady', () => ({ readyLibraryServerKeys: async () => ['s1'] }));
vi.mock('./trackDtoMapping', () => ({ trackToSong: (track: unknown) => track }));
import { fetchMoodTrackPage } from './moodTrackBrowse';

it('does not coalesce concurrent backend-distinct Unicode mood requests', async () => {
  mocks.list.mockImplementation(({ mood }: { mood: string }) => Promise.resolve({
    tracks: [{ id: mood, title: mood }], hasMore: false, total: 1, source: 'local',
  }));
  const [upper, lower] = await Promise.all([
    fetchMoodTrackPage('s1', 'Äther', true, 0, 100),
    fetchMoodTrackPage('s1', 'äther', true, 0, 100),
  ]);
  expect(upper?.songs[0]?.id).toBe('Äther');
  expect(lower?.songs[0]?.id).toBe('äther');
  expect(mocks.list).toHaveBeenCalledTimes(2);
});
