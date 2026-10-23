import { renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ tracks: vi.fn(), albums: vi.fn() }));
vi.mock('@/lib/library/moodTrackBrowse', () => ({
  fetchMoodTrackPage: mocks.tracks,
  MOOD_TRACK_PAGE_SIZE: 100,
}));
vi.mock('@/lib/library/moodAlbumBrowse', () => ({
  fetchMoodAlbumPage: mocks.albums,
  MOOD_ALBUM_FIRST_PAGE: 60,
  MOOD_ALBUM_CATALOG_CHUNK: 200,
}));
vi.mock('@/store/offlineLocalLibrarySyncRevision', () => ({
  useLibraryScopeSyncRevision: () => 0,
}));
import { useMoodTrackBrowse } from './useMoodTrackBrowse';
import { useMoodAlbumBrowse } from './useMoodAlbumBrowse';

const scope = {
  anchorServerId: 'identity-server',
  serverIds: ['identity-server'],
  pairs: [{ serverId: 'identity-server', libraryId: null }],
  fingerprint: 'unicode-identity-regression',
  multiServer: false,
};

it('keeps separate track sessions for moods SQLite NOCASE distinguishes', async () => {
  mocks.tracks.mockImplementation((_server, mood: string) => Promise.resolve({
    songs: [{ id: mood, title: mood, artist: 'Artist', album: 'Album', duration: 1 }],
    total: 1,
    hasMore: false,
  }));
  const hook = renderHook(({ mood }) => useMoodTrackBrowse(
    'identity-server', mood, true, true, 42424, scope,
  ), { initialProps: { mood: 'Äther' } });
  await waitFor(() => expect(hook.result.current.songs[0]?.id).toBe('Äther'));
  hook.rerender({ mood: 'äther' });
  await waitFor(() => expect(hook.result.current.songs[0]?.id).toBe('äther'));
  expect(mocks.tracks).toHaveBeenCalledTimes(2);
  hook.rerender({ mood: 'Äther' });
  await waitFor(() => expect(hook.result.current.songs[0]?.id).toBe('Äther'));
  expect(mocks.tracks).toHaveBeenCalledTimes(2);
});

it('keeps separate album sessions for moods SQLite NOCASE distinguishes', async () => {
  mocks.albums.mockImplementation((_server, mood: string) => Promise.resolve({
    albums: [{ id: mood, name: mood, artist: 'Artist', songCount: 1, duration: 1 }],
    hasMore: false,
  }));
  const hook = renderHook(({ mood }) => useMoodAlbumBrowse(
    'identity-server', mood, true, 'alphabeticalByName', 42424, scope,
  ), { initialProps: { mood: 'Äther' } });
  await waitFor(() => expect(hook.result.current.displayAlbums[0]?.id).toBe('Äther'));
  hook.rerender({ mood: 'äther' });
  await waitFor(() => expect(hook.result.current.displayAlbums[0]?.id).toBe('äther'));
  expect(mocks.albums).toHaveBeenCalledTimes(2);
  hook.rerender({ mood: 'Äther' });
  await waitFor(() => expect(hook.result.current.displayAlbums[0]?.id).toBe('Äther'));
  expect(mocks.albums).toHaveBeenCalledTimes(2);
});
