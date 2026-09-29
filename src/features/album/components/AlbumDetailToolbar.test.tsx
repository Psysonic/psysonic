import { act, screen, waitFor } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';
import { useSelectionStore } from '@/store/selectionStore';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { AlbumDetailToolbar } from './AlbumDetailToolbar';

vi.mock('@/features/contextMenu/components/ContextMenu', () => ({
  AddToPlaylistSubmenu: ({ serverId, songIds }: { serverId?: string; songIds: string[] }) => (
    <div data-testid="playlist-submenu">{`${serverId}:${songIds.join(',')}`}</div>
  ),
}));

const t = ((key: string) => key) as TFunction;
const song = (serverId: string, title: string): SubsonicSong => ({
  id: 'shared',
  serverId,
  title,
  artist: 'Artist',
  album: 'Album',
  albumId: 'album',
  duration: 100,
});

function renderToolbar(songs: SubsonicSong[]) {
  return renderWithProviders(
    <AlbumDetailToolbar
      filterText=""
      setFilterText={vi.fn()}
      inSelectMode
      selectedCount={2}
      showPlPicker={false}
      setShowPlPicker={vi.fn()}
      t={t}
      songs={songs}
      ratings={{}}
      onRate={vi.fn()}
    />,
  );
}

describe('AlbumDetailToolbar owner-safe playlist actions', () => {
  beforeEach(() => useSelectionStore.setState({ selectedIds: new Set() }));

  it('hides add-to-playlist for a mixed-owner selection', () => {
    const songs = [song('srv-a', 'A'), song('srv-b', 'B')];
    useSelectionStore.setState({ selectedIds: new Set(songs.map(ownedEntityKey)) });

    renderToolbar(songs);

    expect(screen.queryByRole('button', { name: 'common.bulkAddToPlaylist' })).not.toBeInTheDocument();
  });

  it('reacts to same-count selection changes and keeps the concrete owner', async () => {
    const songs = [song('srv-a', 'A'), song('srv-b', 'B')];
    useSelectionStore.setState({ selectedIds: new Set([ownedEntityKey(songs[0])]) });
    const setShowPlPicker = vi.fn();
    renderWithProviders(
      <AlbumDetailToolbar
        filterText=""
        setFilterText={vi.fn()}
        inSelectMode
        selectedCount={1}
        showPlPicker
        setShowPlPicker={setShowPlPicker}
        t={t}
        songs={songs}
        ratings={{}}
        onRate={vi.fn()}
      />,
    );

    expect(screen.getByTestId('playlist-submenu')).toHaveTextContent('srv-a:shared');

    act(() => useSelectionStore.setState({
      selectedIds: new Set([ownedEntityKey(songs[1])]),
    }));
    await waitFor(() => expect(screen.getByTestId('playlist-submenu')).toHaveTextContent('srv-b:shared'));
  });
});
