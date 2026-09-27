import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import type { ColDef } from '@/lib/hooks/useTracklistColumns';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { makeSubsonicSong } from '@/test/helpers/factories';
import { useThemeStore } from '@/store/themeStore';
import { TrackRow } from './TrackRow';

const columns: ColDef[] = [
  { key: 'num', i18nKey: null, minWidth: 60, defaultWidth: 60, required: true },
  { key: 'title', i18nKey: 'trackTitle', minWidth: 80, defaultWidth: 180, required: true },
];

function renderRow(
  onDoubleClickSong?: (song: ReturnType<typeof makeSubsonicSong>) => void,
  onCursorClick?: (song: ReturnType<typeof makeSubsonicSong>) => void,
) {
  const song = makeSubsonicSong({ id: 'album-song-1', title: 'Album song' });
  const onPlaySong = vi.fn();
  const { container } = renderWithProviders(
    <TrackRow
      song={song}
      globalIdx={0}
      visibleCols={columns}
      gridStyle={{}}
      currentTrack={null}
      isPlaying={false}
      ratingValue={0}
      isStarred={false}
      inSelectMode={false}
      isContextMenuSong={false}
      onPlaySong={onPlaySong}
      onDoubleClickSong={onDoubleClickSong}
      onRate={vi.fn()}
      onToggleSongStar={vi.fn()}
      onContextMenu={vi.fn()}
      onToggleSelect={vi.fn()}
      onDragStart={vi.fn()}
      setContextMenuSongKey={vi.fn()}
      onCursorClick={onCursorClick}
    />,
  );
  const row = container.querySelector<HTMLElement>('.track-row')!;
  const playButton = container.querySelector<HTMLButtonElement>('.track-row button')!;
  return { song, onPlaySong, row, playButton };
}

describe('TrackRow row click to play', () => {
  afterEach(() => {
    useThemeStore.setState({ trackRowPlayClick: 'single' });
  });

  it('plays on a single click by default', () => {
    const { song, onPlaySong, row } = renderRow();
    fireEvent.click(row);
    expect(onPlaySong).toHaveBeenCalledWith(song);
  });

  it('plays only on a double click in double-click mode', () => {
    useThemeStore.setState({ trackRowPlayClick: 'double' });
    const { song, onPlaySong, row } = renderRow();

    fireEvent.click(row);
    expect(onPlaySong).not.toHaveBeenCalled();

    fireEvent.doubleClick(row);
    expect(onPlaySong).toHaveBeenCalledOnce();
    expect(onPlaySong).toHaveBeenCalledWith(song);
  });

  it('keeps the play button on a single click and does not replay on its double click', () => {
    useThemeStore.setState({ trackRowPlayClick: 'double' });
    const { onPlaySong, playButton } = renderRow();

    fireEvent.click(playButton);
    expect(onPlaySong).toHaveBeenCalledOnce();

    fireEvent.doubleClick(playButton);
    expect(onPlaySong).toHaveBeenCalledOnce();
  });

  it('hands the double click to Orbit when an Orbit handler is set', () => {
    useThemeStore.setState({ trackRowPlayClick: 'double' });
    const onDoubleClickSong = vi.fn();
    const { song, onPlaySong, row } = renderRow(onDoubleClickSong);

    fireEvent.doubleClick(row);
    expect(onDoubleClickSong).toHaveBeenCalledWith(song);
    expect(onPlaySong).not.toHaveBeenCalled();

    // The single click still reaches the page, which shows the Orbit hint there.
    fireEvent.click(row);
    expect(onPlaySong).toHaveBeenCalledWith(song);
  });

  it('moves the list cursor on a plain click in both modes, but not from the play button', () => {
    const onCursorClick = vi.fn();
    const { song, row, playButton } = renderRow(undefined, onCursorClick);
    fireEvent.click(row);
    expect(onCursorClick).toHaveBeenCalledWith(song, expect.anything());

    useThemeStore.setState({ trackRowPlayClick: 'double' });
    fireEvent.click(row);
    expect(onCursorClick).toHaveBeenCalledTimes(2);

    fireEvent.click(playButton);
    expect(onCursorClick).toHaveBeenCalledTimes(2);
  });

  it('leaves the cursor alone when a click toggles the multi-selection', () => {
    const onCursorClick = vi.fn();
    const { row } = renderRow(undefined, onCursorClick);
    fireEvent.click(row, { ctrlKey: true });
    expect(onCursorClick).not.toHaveBeenCalled();
  });
});
