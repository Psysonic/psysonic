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

    expect(screen.getByText('Navidrome sharing')).toBeInTheDocument();
    expect(refreshAll).not.toHaveBeenCalled();
  });

  it('summarizes resource entries without depending on one server shape', () => {
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
        { id: 'album-1', name: 'Album name' },
        { id: 'artist-1', artist: 'Artist name' },
        { id: 'opaque-1' },
      ],
    }, t)).toBe('4 resources: First track, Album name, Artist name, +1 more');
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
