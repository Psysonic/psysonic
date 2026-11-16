import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { Profiler } from 'react';
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
import { makeTrack } from '@/test/helpers/factories';
import { handleAudioFormat, handleAudioStreamProvenance } from '@/features/playback/store/audioEventHandlers';
import type { StreamProvenance } from '@/lib/media/streamFormat';

function verifyLayout(serverId = 'owner.test', generation = 7, provenance?: StreamProvenance) {
  act(() => {
    handleAudioFormat({
      trackId: 'shared', serverId, generation, codec: 'flac', lossless: true, channels: 6,
      channelLayout: { mainChannels: 5, lfeChannels: 1, provenance: 'flac-mask' },
    });
    if (provenance) handleAudioStreamProvenance({ trackId: 'shared', serverId, generation, provenance });
  });
}

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
    // Asks the server even for a downloaded / hot-cached track (the dialog was empty for those).
    expect(mocks.getSongForServer).toHaveBeenCalledWith('srv-owner', 'shared', { evenIfLocal: true });
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

  it('shows the source count first and promotes only a matching original verified layout', async () => {
    mocks.getSongForServer.mockResolvedValue({
      id: 'shared', serverId: 'srv-owner', title: 'Owner Song', artist: 'Owner Artist',
      album: 'Owner Album', duration: 120, channelCount: 6,
    });
    usePlayerStore.setState({ currentTrack: {
      id: 'shared', serverId: 'srv-owner', title: 'Owner Song', artist: 'Owner Artist', album: 'Owner Album', albumId: 'owner-album', duration: 120,
    } });
    usePlayerStore.getState().openSongInfo('shared', 'srv-owner');
    const view = renderWithProviders(<SongInfoModal />);
    expect(await view.findByText('6 ch')).toBeInTheDocument();
    verifyLayout('owner.test', 7, 'original');
    expect(await view.findByText('5.1')).toBeInTheDocument();
    expect(mocks.getSongForServer).toHaveBeenCalledTimes(1);
    act(() => usePlayerStore.setState({ resolvedStreamFormat: null }));
    expect(await view.findByText('6 ch')).toBeInTheDocument();
    verifyLayout('owner.test', 7, 'original');
    expect(view.queryByText('5.1')).not.toBeInTheDocument();
    verifyLayout('owner.test', 8, 'original');
    expect(await view.findByText('5.1')).toBeInTheDocument();
  });

  it.each(['unknown', 'transcoded', undefined] as const)(
    'keeps the source count for %s stream provenance with otherwise valid proof', async provenance => {
    mocks.getSongForServer.mockResolvedValue({
      id: 'shared', serverId: 'srv-owner', title: 'Owner Song', artist: 'Owner Artist',
      album: 'Owner Album', duration: 120, channelCount: 6,
    });
    usePlayerStore.setState({ currentTrack: makeTrack({ id: 'shared', serverId: 'srv-owner' }) });
    usePlayerStore.getState().openSongInfo('shared', 'srv-owner');
    const view = renderWithProviders(<SongInfoModal />);
    expect(await view.findByText('6 ch')).toBeInTheDocument();
    verifyLayout('owner.test', 7, provenance);
    expect(view.queryByText('5.1')).not.toBeInTheDocument();
  });

  it('uses verified original proof even when the server omits its optional count', async () => {
    usePlayerStore.setState({ currentTrack: makeTrack({ id: 'shared', serverId: 'srv-owner' }) });
    usePlayerStore.getState().openSongInfo('shared', 'srv-owner');
    const view = renderWithProviders(<SongInfoModal />);
    await view.findByText('Owner Song');
    verifyLayout('owner.test', 7, 'original');
    expect(await view.findByText('5.1')).toBeInTheDocument();
    expect(mocks.getSongForServer).toHaveBeenCalledTimes(1);
  });

  it('does not replace a contradictory valid source count with the stream layout', async () => {
    mocks.getSongForServer.mockResolvedValue({ id: 'shared', title: 'Owner Song', channelCount: 4 });
    usePlayerStore.setState({ currentTrack: makeTrack({ id: 'shared', serverId: 'srv-owner' }) });
    usePlayerStore.getState().openSongInfo('shared', 'srv-owner');
    const view = renderWithProviders(<SongInfoModal />);
    await view.findByText('4 ch');
    verifyLayout('owner.test', 7, 'original');
    expect(view.queryByText('5.1')).not.toBeInTheDocument();
  });

  it.each([false, true])('retains ownerless request ownership across a server change (in flight: %s)', async inFlight => {
    let complete!: (song: { id: string; title: string; channelCount: number }) => void;
    mocks.getSong.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    usePlayerStore.getState().openSongInfo('shared');
    const view = renderWithProviders(<SongInfoModal />);
    const metadata = { id: 'shared', title: 'Active Song', channelCount: 6 };
    if (!inFlight) {
      await act(async () => complete(metadata));
      await view.findByText('6 ch');
    }
    act(() => {
      useAuthStore.setState({ activeServerId: 'srv-owner' });
      usePlayerStore.setState({ currentTrack: makeTrack({ id: 'shared', serverId: 'srv-owner' }) });
    });
    verifyLayout('owner.test', 7, 'original');
    if (inFlight) await act(async () => complete(metadata));
    expect(await view.findByText('6 ch')).toBeInTheDocument();
    expect(view.queryByText('5.1')).not.toBeInTheDocument();
    expect(mocks.getSong).toHaveBeenCalledTimes(1);
  });

  it('does not use another server\'s valid layout for an explicitly owned modal', async () => {
    mocks.getSongForServer.mockResolvedValue({ id: 'shared', title: 'Owner Song', channelCount: 6 });
    usePlayerStore.setState({ currentTrack: makeTrack({ id: 'shared', serverId: 'srv-active' }) });
    usePlayerStore.getState().openSongInfo('shared', 'srv-owner');
    const view = renderWithProviders(<SongInfoModal />);
    await view.findByText('6 ch');
    verifyLayout('active.test', 7, 'original');
    expect(view.queryByText('5.1')).not.toBeInTheDocument();
  });

  it('does not commit a permanently mounted closed modal on playback updates', () => {
    const onRender = vi.fn();
    renderWithProviders(<Profiler id="closed-song-info" onRender={onRender}><SongInfoModal /></Profiler>);
    const commits = onRender.mock.calls.length;
    act(() => usePlayerStore.setState({ currentTrack: makeTrack({ id: 'shared', serverId: 'srv-owner' }) }));
    verifyLayout('owner.test', 7, 'original');
    expect(onRender).toHaveBeenCalledTimes(commits);
  });
});
