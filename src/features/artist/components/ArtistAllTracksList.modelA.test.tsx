import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import ArtistAllTracksList from '@/features/artist/components/ArtistAllTracksList';
import { useTracklistColumns } from '@/lib/hooks/useTracklistColumns';
import {
  ARTIST_ALL_TRACKS_COLUMNS,
  ARTIST_ALL_TRACKS_STORAGE_KEY,
} from '@/features/artist/utils/artistAllTracksColumns';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { makeSubsonicSong } from '@/test/helpers/factories';

vi.mock('@/lib/dnd/DragDropContext', () => ({
  useDragDrop: () => ({ isDragging: false, startDrag: vi.fn(), payload: null }),
}));

// jsdom has no layout, so the real virtualizer would render no rows at all.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number; getItemKey?: (index: number) => string }) => ({
    getVirtualItems: () => Array.from({ length: opts.count }, (_, index) => ({
      index, key: opts.getItemKey ? opts.getItemKey(index) : String(index), start: index * 48, size: 48,
    })),
    getTotalSize: () => opts.count * 48,
    measureElement: () => {},
    scrollToIndex: () => {},
    options: { scrollMargin: 0 },
  }),
}));

const songs = [
  makeSubsonicSong({ id: 'ar-1', title: 'First' }),
  makeSubsonicSong({ id: 'ar-2', title: 'Second' }),
];

function renderList() {
  const { result } = renderHook(() => useTracklistColumns(ARTIST_ALL_TRACKS_COLUMNS, ARTIST_ALL_TRACKS_STORAGE_KEY));
  return renderWithProviders(
    <ArtistAllTracksList songs={songs} loading={false} failed={false} onPlay={vi.fn()} columns={result.current} />,
  );
}

describe('ArtistAllTracksList — spreadsheet model', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('puts the header and the virtual rows into the sideways-scrolling viewport', () => {
    const { container } = renderList();
    expect(container.querySelector('.tl-viewport .tl-head-clip .tl-header')).not.toBeNull();
    expect(container.querySelectorAll('.tl-viewport .tl-body .track-row')).toHaveLength(2);
  });

  it('lays every row cell out like its header cell', () => {
    const { container } = renderList();
    const headKeys = [...container.querySelectorAll('.tl-header .tl-head-cell')].map(c => c.getAttribute('data-tl-col'));
    const row = container.querySelector('.track-row')!;
    expect([...row.children].map(c => c.getAttribute('data-tl-col'))).toEqual(headKeys);
  });

  it('marks the title text for measuring', () => {
    const view = renderList();
    expect(view.getByText('Second').closest('.tl-cell')).toHaveAttribute('data-tl-text', 'Second');
  });
});
