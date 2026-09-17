import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { open } from '@tauri-apps/plugin-shell';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { makeServer } from '@/test/helpers/factories';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { resetServerReachabilitySnapshot } from '@/lib/network/serverReachability';
import { useAuthStore } from '@/store/authStore';
import { useConfirmModalStore } from '@/store/confirmModalStore';
import { _resetShareStoreForTest, useShareStore } from '@/features/share/store/shareStore';
import Shared from '@/features/share/pages/Shared';
import { shareResourceSummary } from '@/features/share/sharePresentation';
import type { TFunction } from 'i18next';
import { _resetShareSettingsStoreForTest, useShareSettingsStore } from '@/features/share/store/shareSettingsStore';

const api = vi.hoisted(() => ({
  getAlbumForServer: vi.fn(),
}));

vi.mock('@/lib/api/subsonicLibrary', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/subsonicLibrary')>('@/lib/api/subsonicLibrary');
  return { ...actual, getAlbumForServer: api.getAlbumForServer };
});

vi.mock('@/cover/AlbumCoverArtImage', () => ({
  AlbumCoverArtImage: () => <span data-testid="share-cover" />,
}));

const originalConfirmRequest = useConfirmModalStore.getState().request;

beforeEach(() => {
  resetAuthStore();
  _resetShareStoreForTest();
  _resetShareSettingsStoreForTest();
  useShareSettingsStore.getState().setNavidromeSharingEnabled(true);
  resetServerReachabilitySnapshot();
  useConfirmModalStore.setState({ request: originalConfirmRequest });
  vi.clearAllMocks();
});

describe('Shared page', () => {
  it('does not refresh managed links while the integration is disabled', () => {
    const refreshAll = vi.fn(async () => {});
    useShareSettingsStore.getState().setNavidromeSharingEnabled(false);
    useShareStore.setState({ refreshAll });

    renderWithProviders(<Shared />, { route: '/shared' });

    expect(screen.getByRole('heading', { name: 'ND Shares' })).toBeInTheDocument();
    expect(screen.getByText('Navidrome sharing')).toBeInTheDocument();
    expect(refreshAll).not.toHaveBeenCalled();
  });

  it('counts tracks inside album entries without building a clipped title preview', () => {
    const t = ((key: string, options?: { count?: number }) => {
      if (key === 'shared.resources') return `${options?.count} resources`;
      if (key === 'shared.moreResources') return `+${options?.count} more`;
      return key;
    }) as TFunction;
    expect(shareResourceSummary({
      id: 'share-1',
      url: 'https://server.test/share/1',
      entry: [
        { id: 'track-1', title: 'First track' },
        { id: 'album-1', name: 'Album name', isDir: true, songCount: 12 },
      ],
    }, t)).toBe('13 resources');
  });

  it('uses the localized sidebar label as the page heading', () => {
    const refreshAll = vi.fn(async () => {});
    useShareSettingsStore.getState().setNavidromeSharingEnabled(false);
    useShareStore.setState({ refreshAll });

    renderWithProviders(<Shared />, { route: '/shared', language: 'ru' });

    expect(screen.getByRole('heading', { name: 'ND Общий Доступ' })).toBeInTheDocument();
  });

  it('groups every configured server and renders independent states', () => {
    const servers = [
      makeServer({ id: 'loading', name: 'Loading server' }),
      makeServer({ id: 'disabled', name: 'Disabled server' }),
      makeServer({ id: 'unreachable', name: 'Unreachable server' }),
      makeServer({ id: 'error', name: 'Error server' }),
      makeServer({ id: 'empty', name: 'Empty server' }),
    ];
    useAuthStore.setState({ servers });
    useShareStore.setState(state => ({
      ...state,
      refreshAll: vi.fn(async () => {}),
      byServer: {
        loading: { shares: [], loading: true, lastSuccessfulRefresh: null, availability: 'unknown' },
        disabled: { shares: [], loading: false, lastSuccessfulRefresh: null, availability: 'sharing_disabled', error: 'disabled' },
        unreachable: { shares: [], loading: false, lastSuccessfulRefresh: null, availability: 'server_unavailable', error: 'offline' },
        error: { shares: [], loading: false, lastSuccessfulRefresh: null, availability: 'available', error: 'bad response' },
        empty: { shares: [], loading: false, lastSuccessfulRefresh: 1, availability: 'available' },
      },
    }));

    renderWithProviders(<Shared />, { route: '/shared' });

    for (const server of servers) expect(screen.getByRole('heading', { name: server.name })).toBeInTheDocument();
    expect(screen.getByText('Loading shared links…')).toBeInTheDocument();
    expect(screen.getByText('Sharing is disabled')).toBeInTheDocument();
    expect(screen.getByText('Server unreachable')).toBeInTheDocument();
    expect(screen.getByText('Could not load shared links')).toBeInTheDocument();
    expect(screen.getByText('No shared links on this server.')).toBeInTheDocument();
  });

  it('shows the required Navidrome version for an older server', async () => {
    const server = makeServer({ id: 'old-server', name: 'Old server' });
    useAuthStore.setState({
      servers: [server],
      subsonicServerIdentityByServer: {
        'old-server': { type: 'navidrome', serverVersion: '0.63.0' },
      },
    });

    renderWithProviders(<Shared />, { route: '/shared' });

    expect(await screen.findByText('Navidrome 0.64 or newer is required for shared links.')).toBeInTheDocument();
  });

  it('persists a collapsed server section and renders known download permission', () => {
    const server = makeServer({ id: 'server-a', name: 'Home' });
    useAuthStore.setState({ servers: [server] });
    useShareStore.setState(state => ({
      ...state,
      refreshAll: vi.fn(async () => {}),
      byServer: {
        'server-a': {
          shares: [{
            id: 'share-1',
            url: 'https://server.test/share/1',
            downloadable: true,
            entry: [{ id: 'track-1', title: 'First track' }],
          }],
          loading: false,
          lastSuccessfulRefresh: 1,
          availability: 'available',
        },
      },
    }));

    const view = renderWithProviders(<Shared />, { route: '/shared' });
    expect(screen.getByText('Downloads')).toBeInTheDocument();
    expect(screen.getByText('Allowed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(useShareSettingsStore.getState().collapsedServerIds).toEqual({ 'server-a': true });
    expect(localStorage.getItem('psysonic_share_settings')).toContain('server-a');

    view.unmount();
    renderWithProviders(<Shared />, { route: '/shared' });
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('replaces the raw URL with artwork and opens the shared album track list', async () => {
    const server = makeServer({ id: 'server-a', name: 'Home' });
    const share = {
      id: 'share-1',
      url: 'https://server.test/share/1',
      description: 'Road trip',
      entry: [{
        id: 'album-1',
        title: 'Album title',
        isDir: true,
        songCount: 2,
        coverArt: 'cover-1',
      }],
    };
    api.getAlbumForServer.mockResolvedValue({
      album: { id: 'album-1', name: 'Album title' },
      songs: [
        { id: 'track-1', title: 'First track', artist: 'Artist', album: 'Album title', albumId: 'album-1', duration: 61 },
        { id: 'track-2', title: 'Second track', artist: 'Artist', album: 'Album title', albumId: 'album-1', duration: 122 },
      ],
    });
    useAuthStore.setState({ servers: [server] });
    useShareStore.setState(state => ({
      ...state,
      refreshAll: vi.fn(async () => {}),
      byServer: {
        'server-a': {
          shares: [share],
          loading: false,
          lastSuccessfulRefresh: 1,
          availability: 'available',
        },
      },
    }));

    renderWithProviders(<Shared />, { route: '/shared' });

    expect(screen.queryByText(share.url)).not.toBeInTheDocument();
    expect(screen.getByTestId('share-cover')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Shared contents: Album title' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Road trip')).toBeInTheDocument();
    expect(await within(dialog).findByText('First track')).toBeInTheDocument();
    expect(within(dialog).getByText('Second track')).toBeInTheDocument();
    expect(api.getAlbumForServer).toHaveBeenCalledWith('server-a', 'album-1', { mirrorToIndex: false });
  });

  it('shows only directly shared tracks for a partial album share', async () => {
    const server = makeServer({ id: 'server-a', name: 'Home' });
    const share = {
      id: 'share-partial',
      url: 'https://server.test/share/partial',
      entry: [
        { id: 'track-2', title: 'Second track', artist: 'Artist', album: 'Album title', albumId: 'album-1', duration: 122 },
        { id: 'track-4', title: 'Fourth track', artist: 'Artist', album: 'Album title', albumId: 'album-1', duration: 184 },
      ],
    };
    useAuthStore.setState({ servers: [server] });
    useShareStore.setState(state => ({
      ...state,
      refreshAll: vi.fn(async () => {}),
      byServer: {
        'server-a': {
          shares: [share],
          loading: false,
          lastSuccessfulRefresh: 1,
          availability: 'available',
        },
      },
    }));

    renderWithProviders(<Shared />, { route: '/shared' });
    fireEvent.click(screen.getByRole('button', { name: '2 items' }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Second track')).toBeInTheDocument();
    expect(within(dialog).getByText('Fourth track')).toBeInTheDocument();
    expect(api.getAlbumForServer).not.toHaveBeenCalled();
  });

  it('copies, opens, and preserves a row when confirmed deletion fails', async () => {
    const server = makeServer({ id: 'server-a', name: 'Home' });
    const share = {
      id: 'share-1',
      url: 'https://server.test/share/1',
      description: 'Road trip',
      entry: [{ id: 'track-1', title: 'First track' }],
    };
    const deleteShare = vi.fn(async () => { throw new Error('delete failed'); });
    useAuthStore.setState({ servers: [server] });
    useShareStore.setState(state => ({
      ...state,
      refreshAll: vi.fn(async () => {}),
      deleteShare,
      byServer: {
        'server-a': {
          shares: [share],
          loading: false,
          lastSuccessfulRefresh: 1,
          availability: 'available',
        },
      },
    }));
    useConfirmModalStore.setState({ request: vi.fn(async () => true) });

    renderWithProviders(<Shared />, { route: '/shared' });
    const row = screen.getByRole('article');

    fireEvent.click(within(row).getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(share.url));
    expect(await within(row).findByRole('status')).toHaveTextContent('Link copied.');

    fireEvent.click(within(row).getByRole('button', { name: 'Open externally' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(share.url));

    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteShare).toHaveBeenCalledWith('server-a', 'share-1'));
    expect(await within(row).findByRole('alert')).toHaveTextContent('delete failed');
    expect(screen.getByRole('article')).toBeInTheDocument();
  });
});
