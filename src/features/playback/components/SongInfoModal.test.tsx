import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';

const mocks = vi.hoisted(() => ({
  getSong: vi.fn(),
  getSongForServer: vi.fn(),
  libraryGetFacts: vi.fn(),
  ndGetSongPath: vi.fn(),
}));

vi.mock('@/lib/api/subsonicLibrary', () => ({
  getSong: mocks.getSong,
  getSongForServer: mocks.getSongForServer,
}));
vi.mock('@/lib/api/library', () => ({ libraryGetFacts: mocks.libraryGetFacts }));
vi.mock('@/lib/api/navidromeAdmin', () => ({ ndGetSongPath: mocks.ndGetSongPath }));
vi.mock('@/lib/library/libraryReady', () => ({ libraryIsReady: vi.fn(() => Promise.resolve(true)) }));
vi.mock('@/store/libraryIndexStore', () => ({
  useLibraryIndexStore: { getState: () => ({ isIndexEnabled: () => true }) },
}));

import SongInfoModal from './SongInfoModal';
import { resetAuthStore, resetPlayerStore } from '@/test/helpers/storeReset';
import { useAuthStore } from '@/store/authStore';
import { usePlayerStore } from '@/features/playback/store/playerStore';

describe('SongInfoModal server ownership', () => {
  beforeEach(() => {
    resetAuthStore();
    resetPlayerStore();
    Object.values(mocks).forEach(mock => mock.mockReset());
    useAuthStore.setState({
      activeServerId: 'srv-active',
      servers: [
        { id: 'srv-active', name: 'Active', url: 'https://active.test', username: 'a', password: 'p' },
        { id: 'srv-owner', name: 'Owner', url: 'https://owner.test', username: 'owner', password: 'secret' },
      ],
      subsonicServerIdentityByServer: {
        'srv-owner': { type: 'navidrome', serverVersion: '0.62.0', openSubsonic: true },
      },
    });
    mocks.getSongForServer.mockResolvedValue({
      id: 'shared',
      serverId: 'srv-owner',
      title: 'Owner Song',
      artist: 'Owner Artist',
      album: 'Owner Album',
      duration: 120,
    });
    mocks.libraryGetFacts.mockResolvedValue([]);
    mocks.ndGetSongPath.mockResolvedValue('/owner/music/song.flac');
  });

  it('loads metadata, local facts, and native path from the captured owner', async () => {
    usePlayerStore.getState().openSongInfo('shared', 'srv-owner');
    const view = renderWithProviders(<SongInfoModal />);

    expect(await view.findByText('Owner Song')).toBeInTheDocument();
    expect(mocks.getSongForServer).toHaveBeenCalledWith('srv-owner', 'shared');
    expect(mocks.getSong).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.libraryGetFacts).toHaveBeenCalledWith('srv-owner', 'shared'));
    expect(mocks.ndGetSongPath).toHaveBeenCalledWith(
      'https://owner.test',
      'owner',
      'secret',
      'shared',
    );
    expect(await view.findByText('/owner/music/song.flac')).toBeInTheDocument();
  });

  /**
   * `genre` holds one name even where the file carries several; the full set
   * arrives in OpenSubsonic's `genres`. Reported from a library where a track
   * tagged with two genres showed only the first one here, while the album chips
   * and the server's own dialog showed both.
   */
  it('lists every genre a track carries', async () => {
    mocks.getSongForServer.mockResolvedValue({
      id: 'shared',
      serverId: 'srv-owner',
      title: 'Owner Song',
      artist: 'Owner Artist',
      album: 'Owner Album',
      duration: 120,
      genre: 'First',
      genres: [{ name: 'First' }, { name: 'Second' }],
    });

    usePlayerStore.getState().openSongInfo('shared', 'srv-owner');
    const view = renderWithProviders(<SongInfoModal />);

    expect(await view.findByText('First · Second')).toBeInTheDocument();
    expect(view.getByText('Genres')).toBeInTheDocument();
  });

  /**
   * The mood row used to come only from the analysis facts, so a file tagged
   * with MOOD/TMOO showed nothing until it had been analysed.
   */
  it('shows the mood tags the file carries', async () => {
    mocks.getSongForServer.mockResolvedValue({
      id: 'shared',
      serverId: 'srv-owner',
      title: 'Owner Song',
      artist: 'Owner Artist',
      album: 'Owner Album',
      duration: 120,
      moods: ['Love', 'Emotional'],
    });

    usePlayerStore.getState().openSongInfo('shared', 'srv-owner');
    const view = renderWithProviders(<SongInfoModal />);

    expect(await view.findByText('Love · Emotional')).toBeInTheDocument();
  });

  it('keeps the singular label for a single genre', async () => {
    mocks.getSongForServer.mockResolvedValue({
      id: 'shared',
      serverId: 'srv-owner',
      title: 'Owner Song',
      artist: 'Owner Artist',
      album: 'Owner Album',
      duration: 120,
      genre: 'Only',
    });

    usePlayerStore.getState().openSongInfo('shared', 'srv-owner');
    const view = renderWithProviders(<SongInfoModal />);

    expect(await view.findByText('Only')).toBeInTheDocument();
    expect(view.getByText('Genre')).toBeInTheDocument();
  });
});
