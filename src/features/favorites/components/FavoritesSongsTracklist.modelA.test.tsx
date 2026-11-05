import { describe, expect, it, vi } from 'vitest';
import type { ColDef } from '@/lib/hooks/useTracklistColumns';
import FavoritesSongsTracklist from '@/features/favorites/components/FavoritesSongsTracklist';
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
  }),
}));

const columns: ColDef[] = [
  { key: 'num', i18nKey: 'trackRowNumber', minWidth: 60, defaultWidth: 60, required: false, align: 'end' },
  { key: 'title', i18nKey: 'trackTitle', minWidth: 240, defaultWidth: 340, required: true },
  { key: 'remove', i18nKey: null, minWidth: 36, defaultWidth: 36, required: true, align: 'center' },
];

const songs = [
  makeSubsonicSong({ id: 'fav-1', title: 'First' }),
  makeSubsonicSong({ id: 'fav-2', title: 'Second' }),
];

function renderList() {
  return renderWithProviders(
    <FavoritesSongsTracklist
      visibleSongs={songs}
      selectedIds={new Set()}
      selectedCount={0}
      inSelectMode={false}
      toggleSelect={vi.fn()}
      allColumns={columns}
      visibleCols={columns}
      gridStyle={{ gridTemplateColumns: '60px 340px 36px' }}
      colWidths={{ num: 60, title: 340, remove: 36 }}
      contentWidth={436}
      setColumnWidth={vi.fn()}
      moveColumn={vi.fn()}
      colVisible={new Set(['num', 'title', 'remove'])}
      toggleColumn={vi.fn()}
      resetColumns={vi.fn()}
      pickerOpen={false}
      setPickerOpen={vi.fn()}
      pickerRef={{ current: null }}
      tracklistRef={{ current: null }}
      startResize={vi.fn()}
      handleSortClick={vi.fn()}
      sort={null}
      ratings={{}}
      handleRate={vi.fn()}
      removeSong={vi.fn()}
      hasFilters={false}
    />,
  );
}

describe('FavoritesSongsTracklist — spreadsheet model', () => {
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
