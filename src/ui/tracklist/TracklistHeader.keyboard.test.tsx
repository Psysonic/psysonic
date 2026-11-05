import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { TFunction } from 'i18next';
import type { ColDef } from '@/lib/hooks/useTracklistColumns';
import { TracklistHeader } from '@/ui/tracklist/TracklistHeader';

const t = ((key: string) => key) as unknown as TFunction;

const COLS: readonly ColDef[] = [
  { key: 'num',      i18nKey: null,            minWidth: 60, defaultWidth: 60,  required: true, align: 'end' },
  { key: 'title',    i18nKey: 'trackTitle',    minWidth: 240, defaultWidth: 340, required: true },
  { key: 'artist',   i18nKey: 'trackArtist',   minWidth: 80, defaultWidth: 180, required: false },
  { key: 'duration', i18nKey: 'trackDuration', minWidth: 72, defaultWidth: 92,  required: false, align: 'end' },
];

function setup() {
  const props = {
    onSort: vi.fn(),
    onReorder: vi.fn(),
    onResizeBy: vi.fn(),
    onAutofit: vi.fn(),
    onParentKey: vi.fn(),
  };
  render(
    <div onKeyDown={props.onParentKey}>
      <TracklistHeader
        cols={COLS}
        gridStyle={{ gridTemplateColumns: '60px 340px 180px 92px' }}
        renderLabel={col => (col.key === 'num' ? '#' : col.key.toUpperCase())}
        isSortable={key => key === 'title' || key === 'artist'}
        onSort={props.onSort}
        onResizeStart={vi.fn()}
        onAutofit={props.onAutofit}
        onResizeBy={props.onResizeBy}
        widthOf={() => 100}
        onReorder={props.onReorder}
        menu={{
          allColumns: COLS,
          colVisible: new Set(COLS.map(c => c.key)),
          toggleColumn: vi.fn(),
          resetColumns: vi.fn(),
          onFitAll: vi.fn(),
        }}
        t={t}
      />
    </div>,
  );
  return props;
}

const head = (text: string) => screen.getByText(text).closest('.tl-head-cell') as HTMLElement;

describe('TracklistHeader — keyboard', () => {
  it('lets the keyboard reach the headers', () => {
    setup();
    expect(head('TITLE')).toHaveAttribute('tabindex', '0');
    expect(head('DURATION')).toHaveAttribute('tabindex', '0');
  });

  it('sorts with Enter and with Space', () => {
    const props = setup();
    fireEvent.keyDown(head('TITLE'), { key: 'Enter' });
    fireEvent.keyDown(head('ARTIST'), { key: ' ' });
    expect(props.onSort).toHaveBeenNthCalledWith(1, 'title');
    expect(props.onSort).toHaveBeenNthCalledWith(2, 'artist');
  });

  it('moves the focused column with Ctrl+Shift+arrows', () => {
    const props = setup();
    fireEvent.keyDown(head('ARTIST'), { key: 'ArrowLeft', ctrlKey: true, shiftKey: true });
    expect(props.onReorder).toHaveBeenLastCalledWith('artist', 'title', 'before');
    fireEvent.keyDown(head('ARTIST'), { key: 'ArrowRight', ctrlKey: true, shiftKey: true });
    expect(props.onReorder).toHaveBeenLastCalledWith('artist', 'duration', 'after');
    expect(props.onParentKey).not.toHaveBeenCalled();
  });

  it('opens the column menu with Shift+F10 and with the context-menu key', () => {
    setup();
    fireEvent.keyDown(head('ARTIST'), { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.keyDown(head('ARTIST'), { key: 'ContextMenu' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('resizes the column from its focused divider with the arrow keys', () => {
    const props = setup();
    const grip = screen.getAllByRole('separator')[2];
    expect(grip).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(grip, { key: 'ArrowRight' });
    fireEvent.keyDown(grip, { key: 'ArrowLeft', shiftKey: true });
    expect(props.onResizeBy).toHaveBeenNthCalledWith(1, 2, 10);
    expect(props.onResizeBy).toHaveBeenNthCalledWith(2, 2, -50);
    expect(props.onParentKey).not.toHaveBeenCalled();
  });

  it('fits the column to its content with Enter on its divider', () => {
    const props = setup();
    fireEvent.keyDown(screen.getAllByRole('separator')[1], { key: 'Enter' });
    expect(props.onAutofit).toHaveBeenCalledWith(1);
    expect(props.onSort).not.toHaveBeenCalled();
  });

  it('leaves Space on a divider to the app instead of sorting', () => {
    const props = setup();
    fireEvent.keyDown(screen.getAllByRole('separator')[1], { key: ' ' });
    expect(props.onSort).not.toHaveBeenCalled();
    expect(props.onParentKey).toHaveBeenCalledTimes(1);
  });

  // Alt+Left/Right is the app's back/forward shortcut.
  it('leaves Alt+arrows to the app', () => {
    const props = setup();
    fireEvent.keyDown(head('ARTIST'), { key: 'ArrowLeft', altKey: true });
    fireEvent.keyDown(screen.getAllByRole('separator')[2], { key: 'ArrowLeft', altKey: true });
    expect(props.onReorder).not.toHaveBeenCalled();
    expect(props.onResizeBy).not.toHaveBeenCalled();
    expect(props.onParentKey).toHaveBeenCalledTimes(2);
  });

  it('leaves every Alt combination to the app, Alt+Enter included', () => {
    const props = setup();
    fireEvent.keyDown(head('TITLE'), { key: 'Enter', altKey: true });
    fireEvent.keyDown(head('ARTIST'), { key: 'ArrowLeft', altKey: true, ctrlKey: true, shiftKey: true });
    expect(props.onSort).not.toHaveBeenCalled();
    expect(props.onReorder).not.toHaveBeenCalled();
    expect(props.onParentKey).toHaveBeenCalledTimes(2);
  });
});
