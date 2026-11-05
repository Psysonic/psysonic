import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, screen } from '@testing-library/react';
import { useTracklistColumns } from '@/lib/hooks/useTracklistColumns';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { makeSubsonicSong } from '@/test/helpers/factories';
import RandomMixTracklist from '@/features/randomMix/components/RandomMixTracklist';
import RandomMixTrackRow from '@/features/randomMix/components/RandomMixTrackRow';
import { RANDOM_MIX_COLUMNS, RANDOM_MIX_STORAGE_KEY } from '@/features/randomMix/utils/randomMixColumns';
import { songToTrack } from '@/lib/media/songToTrack';

vi.mock('@/lib/dnd/DragDropContext', () => ({
  useDragDrop: () => ({ isDragging: false, startDrag: vi.fn(), payload: null }),
}));

const songs = [
  makeSubsonicSong({ id: 'rm-1', title: 'First', artist: 'Band A', album: 'Rec', genre: 'Rock' }),
  makeSubsonicSong({ id: 'rm-2', title: 'Second', artist: 'Band B', album: 'Rec', genre: 'Pop' }),
];

function renderTable(withGenre: boolean) {
  const { result } = renderHook(() => useTracklistColumns(RANDOM_MIX_COLUMNS, RANDOM_MIX_STORAGE_KEY));
  const columns = result.current;
  const displayCols = withGenre ? columns.visibleCols : columns.visibleCols.filter(c => c.key !== 'genre');
  return renderWithProviders(
    <RandomMixTracklist columns={columns} displayCols={displayCols} songs={songs} listProps={{}}>
      {gridStyle => songs.map((song, idx) => (
        <RandomMixTrackRow
          key={song.id}
          song={song}
          idx={idx}
          visibleCols={displayCols}
          gridStyle={gridStyle}
          track={songToTrack(song)}
          queueSongs={songs.map(songToTrack)}
          isCurrentTrack={false}
          isPlaying={false}
          isContextActive={false}
          orbitActive={false}
          doubleClickToPlay={false}
          onCursorClick={vi.fn()}
          previewingId={null}
          previewAudioStarted={false}
          starredOverrides={{}}
          isStarred={false}
          customGenreBlacklist={[]}
          addedArtist={null}
          addedGenre={null}
          isGenreBlocked={false}
          onPlay={vi.fn()}
          onQueueHint={vi.fn()}
          onAddTrackToOrbit={vi.fn()}
          onOpenContextMenu={vi.fn()}
          onToggleStar={vi.fn()}
          onBlacklistArtist={vi.fn()}
          onBlacklistGenre={vi.fn()}
        />
      ))}
    </RandomMixTracklist>,
  );
}

describe('Random mix table — spreadsheet model', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('puts the table into the sideways-scrolling viewport', () => {
    const { container } = renderTable(true);
    expect(container.querySelector('.tl-viewport .tl-head-clip .tl-header')).not.toBeNull();
    expect(container.querySelectorAll('.tl-viewport .tl-body .track-row')).toHaveLength(2);
  });

  it('lays every row cell out like its header cell, genre included', () => {
    const { container } = renderTable(true);
    const headKeys = [...container.querySelectorAll('.tl-header .tl-head-cell')].map(c => c.getAttribute('data-tl-col'));
    expect(headKeys).toEqual(['num', 'title', 'artist', 'album', 'genre', 'favorite', 'duration']);
    const row = container.querySelector('.tl-body .track-row')!;
    expect([...row.children].map(c => c.getAttribute('data-tl-col'))).toEqual(headKeys);
  });

  it('leaves the genre out of the genre-mix table', () => {
    const { container } = renderTable(false);
    const headKeys = [...container.querySelectorAll('.tl-header .tl-head-cell')].map(c => c.getAttribute('data-tl-col'));
    expect(headKeys).not.toContain('genre');
    const row = container.querySelector('.tl-body .track-row')!;
    expect([...row.children].map(c => c.getAttribute('data-tl-col'))).toEqual(headKeys);
  });

  it('marks title and album for measuring and tooltips', () => {
    renderTable(true);
    expect(screen.getByText('Second').closest('.tl-cell')).toHaveAttribute('data-tl-text', 'Second');
  });
});
