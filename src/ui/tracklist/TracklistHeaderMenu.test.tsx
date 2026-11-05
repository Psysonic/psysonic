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
const ALL: readonly ColDef[] = [
  ...COLS,
  { key: 'bpm', i18nKey: 'trackBpm', minWidth: 50, defaultWidth: 70, required: false, align: 'end' },
];

function setup() {
  const menu = {
    allColumns: ALL,
    colVisible: new Set(['num', 'title', 'artist', 'duration']),
    toggleColumn: vi.fn(),
    resetColumns: vi.fn(),
    onFitAll: vi.fn(),
  };
  const onReorder = vi.fn();
  render(
    <TracklistHeader
      cols={COLS}
      gridStyle={{ gridTemplateColumns: '60px 340px 180px 92px' }}
      renderLabel={col => (col.key === 'num' ? '#' : col.key.toUpperCase())}
      onResizeStart={vi.fn()}
      onAutofit={vi.fn()}
      widthOf={() => 100}
      onReorder={onReorder}
      menu={menu}
      t={t}
    />,
  );
  return { menu, onReorder };
}

function openOn(text: string) {
  fireEvent.contextMenu(screen.getByText(text), { clientX: 120, clientY: 40 });
}

describe('TracklistHeader — right-click menu', () => {
  it('opens on a right-click on the header', () => {
    setup();
    openOn('ARTIST');
    expect(screen.getByText('albumDetail.fitAllColumns')).toBeInTheDocument();
    expect(screen.getByText('albumDetail.resetColumns')).toBeInTheDocument();
  });

  it('lists the optional columns with their state and toggles them', () => {
    const { menu } = setup();
    openOn('ARTIST');
    const bpm = screen.getByRole('menuitemcheckbox', { name: 'albumDetail.trackBpm' });
    expect(bpm).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('menuitemcheckbox', { name: 'albumDetail.trackArtist' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('menuitemcheckbox', { name: 'albumDetail.trackTitle' })).toBeNull();
    fireEvent.click(bpm);
    expect(menu.toggleColumn).toHaveBeenCalledWith('bpm');
  });

  it('fits all columns and closes', () => {
    const { menu } = setup();
    openOn('ARTIST');
    fireEvent.click(screen.getByText('albumDetail.fitAllColumns'));
    expect(menu.onFitAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('albumDetail.fitAllColumns')).toBeNull();
  });

  it('resets the columns', () => {
    const { menu } = setup();
    openOn('ARTIST');
    fireEvent.click(screen.getByText('albumDetail.resetColumns'));
    expect(menu.resetColumns).toHaveBeenCalledTimes(1);
  });

  it('moves the column it was opened on one place left or right', () => {
    const { onReorder } = setup();
    openOn('ARTIST');
    fireEvent.click(screen.getByText('albumDetail.moveColumnLeft'));
    expect(onReorder).toHaveBeenLastCalledWith('artist', 'title', 'before');
    openOn('ARTIST');
    fireEvent.click(screen.getByText('albumDetail.moveColumnRight'));
    expect(onReorder).toHaveBeenLastCalledWith('artist', 'duration', 'after');
  });

  it('offers no move left right after the number column', () => {
    setup();
    openOn('TITLE');
    expect(screen.queryByText('albumDetail.moveColumnLeft')).toBeNull();
    expect(screen.getByText('albumDetail.moveColumnRight')).toBeInTheDocument();
  });

  it('offers no moves for the number column', () => {
    setup();
    openOn('#');
    expect(screen.queryByText('albumDetail.moveColumnLeft')).toBeNull();
    expect(screen.queryByText('albumDetail.moveColumnRight')).toBeNull();
  });

  it('closes on Escape', () => {
    setup();
    openOn('ARTIST');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('albumDetail.fitAllColumns')).toBeNull();
  });

  it('closes on a press outside the menu', () => {
    setup();
    openOn('ARTIST');
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('albumDetail.fitAllColumns')).toBeNull();
  });

  // The menu is portalled, but React still bubbles its events to the header.
  it('stays as it is on a right-click inside it', () => {
    setup();
    openOn('ARTIST');
    fireEvent.contextMenu(screen.getByText('albumDetail.fitAllColumns'), { clientX: 300, clientY: 200 });
    expect(screen.getByText('albumDetail.moveColumnLeft')).toBeInTheDocument();
    expect(screen.getByText('albumDetail.moveColumnRight')).toBeInTheDocument();
  });
});

describe('TracklistHeader — right-click menu and the keyboard', () => {
  it('gives the focus back to the header it was opened from', () => {
    setup();
    const artist = screen.getByText('ARTIST').closest('.tl-head-cell') as HTMLElement;
    artist.focus();
    fireEvent.keyDown(artist, { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menu').contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(document.activeElement).toBe(artist);
  });

  it('closes when Tab leaves it', () => {
    setup();
    openOn('ARTIST');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  // Space is the app's play/pause key; inside the menu it toggles the column.
  it('toggles a column with Space without reaching the app', () => {
    const { menu } = setup();
    const appKeys = vi.fn();
    window.addEventListener('keydown', appKeys);
    openOn('ARTIST');
    fireEvent.keyDown(screen.getByRole('menuitemcheckbox', { name: 'albumDetail.trackBpm' }), { key: ' ' });
    window.removeEventListener('keydown', appKeys);
    expect(menu.toggleColumn).toHaveBeenCalledWith('bpm');
    expect(appKeys).not.toHaveBeenCalled();
  });
});
