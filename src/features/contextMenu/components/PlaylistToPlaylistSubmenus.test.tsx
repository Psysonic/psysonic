import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import type { SubsonicPlaylist } from '@/lib/api/subsonicTypes';
import { usePlaylistStore } from '@/features/playlist';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';
import { SinglePlaylistToPlaylistSubmenu } from './PlaylistToPlaylistSubmenus';

const playlist = (name: string): SubsonicPlaylist => ({
  id: name.toLowerCase(), name, songCount: 0, duration: 0, created: '', changed: '', serverId: 'srv',
});

beforeEach(() => {
  usePlaylistStore.setState({
    playlists: ['Source', 'Gamma', 'Alpha', 'Delta', 'Beta', 'Zeta', 'Epsilon'].map(playlist),
    recentIds: [ownedEntityKey(playlist('Source')), ownedEntityKey(playlist('Delta'))],
  });
});

describe('SinglePlaylistToPlaylistSubmenu targets', () => {
  it('offers recent and alphabetical targets, never the playlist itself', () => {
    renderWithProviders(<SinglePlaylistToPlaylistSubmenu playlist={playlist('Source')} onDone={vi.fn()} />);

    expect(screen.getByText('Recently used')).toBeInTheDocument();
    const names = Array.from(document.querySelectorAll('.context-menu-item:not(.context-submenu-new)'))
      .map(row => row.textContent);
    expect(names).toEqual(['Delta', 'Alpha', 'Beta', 'Delta', 'Epsilon', 'Gamma', 'Zeta']);
  });
});
