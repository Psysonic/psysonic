import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

const hoisted = vi.hoisted(() => ({
  playlistState: {
    playlists: [] as Array<{ id: string; name: string; serverId?: string }>,
    recentIds: [] as string[],
    createPlaylist: vi.fn(),
    touchPlaylist: vi.fn(),
    fetchPlaylistsForServer: vi.fn(async () => undefined),
  },
}));

vi.mock('@/features/playlist', () => ({
  usePlaylistStore: (selector: (state: typeof hoisted.playlistState) => unknown) =>
    selector(hoisted.playlistState),
  addTracksToPlaylistWithDedup: vi.fn(),
  showAddTracksDedupToast: vi.fn(),
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: { activeServerId: string }) => unknown) =>
    selector({ activeServerId: 'srv-a' }),
}));

import { AddToPlaylistSubmenu } from '@/features/contextMenu/components/AddToPlaylistSubmenu';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';

describe('AddToPlaylistSubmenu', () => {
  beforeEach(() => {
    hoisted.playlistState.playlists = [];
    hoisted.playlistState.recentIds = [];
    hoisted.playlistState.fetchPlaylistsForServer.mockClear();
  });

  it('does not refetch repeatedly when an owner has no playlists', async () => {
    const view = renderWithProviders(
      <AddToPlaylistSubmenu songIds={['track-1']} serverId="srv-b" onDone={vi.fn()} />,
    );

    await waitFor(() => {
      expect(hoisted.playlistState.fetchPlaylistsForServer).toHaveBeenCalledTimes(1);
    });

    hoisted.playlistState.playlists = [];
    view.rerender(
      <AddToPlaylistSubmenu songIds={['track-1']} serverId="srv-b" onDone={vi.fn()} />,
    );

    await waitFor(() => {
      expect(hoisted.playlistState.fetchPlaylistsForServer).toHaveBeenCalledTimes(1);
    });
  });

  it('lists the recently used playlists above the alphabetical ones', () => {
    hoisted.playlistState.playlists = ['Gamma', 'Alpha', 'Delta', 'Beta', 'Zeta', 'Epsilon']
      .map(name => ({ id: name.toLowerCase(), name, serverId: 'srv-a' }));
    hoisted.playlistState.recentIds = [ownedEntityKey({ id: 'zeta', serverId: 'srv-a' })];
    renderWithProviders(<AddToPlaylistSubmenu songIds={['track-1']} serverId="srv-a" onDone={vi.fn()} />);

    expect(screen.getByText('Recently used')).toBeInTheDocument();
    const names = Array.from(document.querySelectorAll('.context-menu-item:not(.context-submenu-new)'))
      .map(row => row.textContent);
    expect(names).toEqual(['Zeta', 'Alpha', 'Beta', 'Delta', 'Epsilon', 'Gamma', 'Zeta']);
  });
});
