import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';
import { useSelectionStore } from '@/store/selectionStore';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';

const openContextMenu = vi.hoisted(() => vi.fn());

vi.mock('@/features/playback/store/playerStore', () => ({
  usePlayerStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ contextMenu: { isOpen: false }, openContextMenu }),
}));
vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/lib/hooks/useTracklistColumns', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/hooks/useTracklistColumns')>()),
  useTracklistColumns: () => ({
    colVisible: new Set(['title']),
    visibleCols: [{ key: 'title', width: 100 }],
    gridStyle: {},
    startResize: vi.fn(),
    startFlexColumnResize: vi.fn(),
    toggleColumn: vi.fn(),
    resetColumns: vi.fn(),
    pickerOpen: false,
    setPickerOpen: vi.fn(),
    pickerRef: { current: null },
    tracklistRef: { current: null },
  }),
}));
vi.mock('@/ui/TracklistColumnPicker', () => ({ TracklistColumnPicker: () => null }));
vi.mock('@/features/album/components/TracklistHeaderRow', () => ({ TracklistHeaderRow: () => null }));
vi.mock('@/features/album/components/DiscHeaderCover', () => ({ DiscHeaderCover: () => null }));
// A stand-in row: the wiring under test is which menu the list opens for a
// right-click, not how a row paints itself.
vi.mock('@/features/album/components/TrackRow', () => ({
  TrackRow: ({ song, onContextMenu }: {
    song: SubsonicSong;
    onContextMenu: (x: number, y: number, track: unknown, type: string) => void;
  }) => (
    <button
      type="button"
      data-testid={`row-${song.id}`}
      onClick={() => onContextMenu(10, 20, { id: song.id, serverId: song.serverId }, 'album-song')}
    >
      {song.title}
    </button>
  ),
}));

import AlbumTrackList from './AlbumTrackList';

const SONGS: SubsonicSong[] = [
  { id: 's1', serverId: 'srv', title: 'One', artist: 'A', album: 'Rec', albumId: 'al', duration: 60 },
  { id: 's2', serverId: 'srv', title: 'Two', artist: 'A', album: 'Rec', albumId: 'al', duration: 60 },
  { id: 's3', serverId: 'srv', title: 'Three', artist: 'A', album: 'Rec', albumId: 'al', duration: 60 },
];

const onContextMenu = vi.fn();

function renderList() {
  return renderWithProviders(
    <AlbumTrackList
      songs={SONGS}
      hasVariousArtists={false}
      currentTrack={null}
      isPlaying={false}
      ratings={{}}
      userRatingOverrides={{}}
      starredSongs={new Set()}
      onPlaySong={vi.fn()}
      onRate={vi.fn()}
      onToggleSongStar={vi.fn()}
      onContextMenu={onContextMenu}
    />,
  );
}

describe('AlbumTrackList right-click with a selection', () => {
  beforeEach(() => {
    openContextMenu.mockClear();
    onContextMenu.mockClear();
    useSelectionStore.setState({ selectedIds: new Set() });
  });

  it('opens the multi-track menu for every selected row', () => {
    renderList();
    // The list clears the selection whenever the song array changes, mount
    // included — so pick the rows the way a user does, after it is on screen.
    act(() => useSelectionStore.setState({
      selectedIds: new Set([ownedEntityKey(SONGS[0]), ownedEntityKey(SONGS[2])]),
    }));

    fireEvent.click(screen.getByTestId('row-s1'));

    expect(onContextMenu).not.toHaveBeenCalled();
    expect(openContextMenu).toHaveBeenCalledTimes(1);
    const [, , item, type] = openContextMenu.mock.calls[0];
    expect(type).toBe('multi-song');
    expect((item as { id: string }[]).map(track => track.id)).toEqual(['s1', 's3']);
  });

  it('keeps the single-track menu when only one row is picked', () => {
    renderList();
    act(() => useSelectionStore.setState({ selectedIds: new Set([ownedEntityKey(SONGS[1])]) }));

    fireEvent.click(screen.getByTestId('row-s2'));

    expect(openContextMenu).not.toHaveBeenCalled();
    expect(onContextMenu).toHaveBeenCalledWith(10, 20, expect.objectContaining({ id: 's2' }), 'album-song');
  });

  it('keeps the single-track menu with no selection at all', () => {
    renderList();

    fireEvent.click(screen.getByTestId('row-s3'));

    expect(openContextMenu).not.toHaveBeenCalled();
    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });
});
