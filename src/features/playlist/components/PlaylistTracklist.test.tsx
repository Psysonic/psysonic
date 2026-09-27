import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import type { ColDef } from '@/lib/hooks/useTracklistColumns';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import PlaylistTracklist from '@/features/playlist/components/PlaylistTracklist';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { makeSubsonicSong } from '@/test/helpers/factories';
import { songToTrack } from '@/lib/media/songToTrack';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { useThemeStore } from '@/store/themeStore';

vi.mock('@/lib/dnd/DragDropContext', () => ({
  useDragDrop: () => ({ isDragging: false, startDrag: vi.fn(), payload: null }),
}));

// jsdom has no layout, so the real virtualizer would render no rows at all.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number; getItemKey: (index: number) => string }) => ({
    getVirtualItems: () => Array.from({ length: opts.count }, (_, index) => ({
      index, key: opts.getItemKey(index), start: index * 48, size: 48,
    })),
    getTotalSize: () => opts.count * 48,
    measureElement: () => {},
  }),
}));

const columns: ColDef[] = [
  { key: 'num', i18nKey: null, minWidth: 60, defaultWidth: 60, required: true },
  { key: 'title', i18nKey: 'trackTitle', minWidth: 80, defaultWidth: 180, required: true },
];

function renderList(tracksReadOnly: boolean, songs: SubsonicSong[] = []) {
  const tracks = songs.map(songToTrack);
  return renderWithProviders(
    <PlaylistTracklist
      allColumns={columns}
      visibleCols={columns}
      gridStyle={{}}
      colVisible={new Set(['num', 'title'])}
      toggleColumn={vi.fn()}
      resetColumns={vi.fn()}
      pickerOpen={false}
      setPickerOpen={vi.fn()}
      pickerRef={{ current: null }}
      startResize={vi.fn()}
      startFlexColumnResize={vi.fn()}
      tracklistRef={{ current: null }}
      songs={songs}
      displayedSongs={songs}
      displayedTracks={tracks}
      isFiltered={false}
      hasActiveFilter={false}
      id="pl-1"
      serverId="srv-a"
      sortKey="natural"
      setSortKey={vi.fn()}
      sortDir="asc"
      setSortDir={vi.fn()}
      sortClickCount={0}
      setSortClickCount={vi.fn()}
      selectedIds={new Set()}
      setSelectedIds={vi.fn()}
      allSelected={false}
      toggleAll={vi.fn()}
      toggleSelect={vi.fn()}
      showBulkPlPicker={false}
      setShowBulkPlPicker={vi.fn()}
      bulkRemove={vi.fn()}
      contextMenuSongId={null}
      setContextMenuSongId={vi.fn()}
      dropTargetIdx={null}
      ratings={{}}
      starredSongs={new Set()}
      handleRate={vi.fn()}
      handleToggleStar={vi.fn()}
      handleRowMouseDown={vi.fn()}
      handleRowMouseEnter={vi.fn()}
      removeSong={vi.fn()}
      setSearchOpen={vi.fn()}
      tracksReadOnly={tracksReadOnly}
    />,
  );
}

describe('PlaylistTracklist read-only smart controls', () => {
  it('hides the add-first-song action when tracks are read-only', () => {
    const view = renderList(true);
    expect(view.getByText('This smart playlist has no matching tracks.')).toBeInTheDocument();
    expect(view.queryByRole('button', { name: /Add your first song/i })).not.toBeInTheDocument();
  });

  it('keeps the add-first-song action for regular playlists', () => {
    const view = renderList(false);
    expect(view.getByRole('button', { name: /Add your first song/i })).toBeInTheDocument();
  });
});

describe('PlaylistTracklist row click to play', () => {
  const playTrack = vi.fn();
  const songs = [
    makeSubsonicSong({ id: 'pl-song-1', title: 'First' }),
    makeSubsonicSong({ id: 'pl-song-2', title: 'Second' }),
  ];

  beforeEach(() => {
    playTrack.mockReset();
    usePlayerStore.setState({ playTrack });
  });

  afterEach(() => {
    useThemeStore.setState({ trackRowPlayClick: 'single' });
  });

  function secondRow(container: HTMLElement): HTMLElement {
    const rows = container.querySelectorAll<HTMLElement>('.track-row');
    expect(rows).toHaveLength(2);
    return rows[1]!;
  }

  it('plays the clicked row on a single click by default', () => {
    const { container } = renderList(false, songs);
    fireEvent.click(secondRow(container));
    expect(playTrack).toHaveBeenCalledOnce();
    expect(playTrack.mock.calls[0]![0]).toMatchObject({ id: 'pl-song-2' });
  });

  it('plays the row only on a double click in double-click mode', () => {
    useThemeStore.setState({ trackRowPlayClick: 'double' });
    const { container } = renderList(false, songs);
    const row = secondRow(container);

    fireEvent.click(row);
    expect(playTrack).not.toHaveBeenCalled();

    fireEvent.doubleClick(row);
    expect(playTrack).toHaveBeenCalledOnce();
    expect(playTrack.mock.calls[0]![0]).toMatchObject({ id: 'pl-song-2' });
  });
});
