import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import ArtistDetailTopTracks from '@/features/artist/components/ArtistDetailTopTracks';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { makeSubsonicSong } from '@/test/helpers/factories';

vi.mock('@/lib/dnd/DragDropContext', () => ({
  useDragDrop: () => ({ isDragging: false, startDrag: vi.fn(), payload: null }),
}));
// The cover goes through the cover cache, which this test has no backend for.
vi.mock('@/features/artist/components/ArtistTopTrackCover', () => ({
  default: () => <div data-testid="top-track-cover" />,
}));

const songs = [
  makeSubsonicSong({ id: 'top-1', title: 'First', album: 'Rec One' }),
  makeSubsonicSong({ id: 'top-2', title: 'Second', album: 'Rec Two' }),
];

function renderTable() {
  return renderWithProviders(
    <ArtistDetailTopTracks topSongs={songs} albums={[]} playTopSongWithContinuation={vi.fn(async () => {})} />,
  );
}

describe('ArtistDetailTopTracks — spreadsheet model', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('puts the table into the sideways-scrolling viewport', () => {
    const { container } = renderTable();
    expect(container.querySelector('.tl-viewport .tl-head-clip .tl-header')).not.toBeNull();
    expect(container.querySelectorAll('.tl-viewport .tl-body .track-row')).toHaveLength(2);
  });

  it('lays every row cell out like its header cell', () => {
    const { container } = renderTable();
    const headKeys = [...container.querySelectorAll('.tl-header .tl-head-cell')].map(c => c.getAttribute('data-tl-col'));
    expect(headKeys).toEqual(['num', 'title', 'album', 'duration']);
    const row = container.querySelector('.tl-body .track-row')!;
    expect([...row.children].map(c => c.getAttribute('data-tl-col'))).toEqual(headKeys);
  });

  it('marks title and album for measuring and tooltips', () => {
    renderTable();
    expect(screen.getByText('Second').closest('.tl-cell')).toHaveAttribute('data-tl-text', 'Second');
    expect(screen.getByText('Rec Two').closest('.tl-cell')).toHaveAttribute('data-tl-text', 'Rec Two');
  });

  it('remembers its own column widths', () => {
    const { container } = renderTable();
    const grips = container.querySelectorAll('[role="separator"]');
    expect(grips).toHaveLength(4);
    fireEvent.keyDown(grips[2], { key: 'ArrowRight' });
    const saved = JSON.parse(localStorage.getItem('psysonic_artist_top_tracks_columns') ?? '{}');
    expect(saved.widths.album).toBeGreaterThan(0);
  });
});
