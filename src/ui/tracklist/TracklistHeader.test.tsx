import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import type { TFunction } from 'i18next';
import type { ColDef } from '@/lib/hooks/useTracklistColumns';
import { TracklistHeader } from '@/ui/tracklist/TracklistHeader';

const t = ((key: string) => key) as unknown as TFunction;

const COLS: readonly ColDef[] = [
  { key: 'num',      i18nKey: null,            minWidth: 60, defaultWidth: 60,  required: true, align: 'end' },
  { key: 'title',    i18nKey: 'trackTitle',    minWidth: 240, defaultWidth: 340, required: true },
  { key: 'duration', i18nKey: 'trackDuration', minWidth: 72, defaultWidth: 92,  required: false, align: 'end' },
];

function setup(overrides: Partial<React.ComponentProps<typeof TracklistHeader>> = {}) {
  const props = {
    cols: COLS,
    gridStyle: { gridTemplateColumns: '60px 340px 92px' },
    renderLabel: (col: ColDef) => (col.key === 'num' ? '#' : col.key.toUpperCase()),
    sort: null,
    isSortable: (key: string) => key === 'title',
    onSort: vi.fn(),
    onResizeStart: vi.fn(),
    onAutofit: vi.fn(),
    widthOf: (key: string) => ({ num: 60, title: 340, duration: 92 } as Record<string, number>)[key],
    t,
    ...overrides,
  };
  render(<TracklistHeader {...props} />);
  return props;
}

describe('TracklistHeader', () => {
  it('sorts when a sortable header is clicked', () => {
    const props = setup();
    fireEvent.click(screen.getByText('TITLE'));
    expect(props.onSort).toHaveBeenCalledWith('title');
  });

  it('does not sort a column that is not sortable', () => {
    const props = setup();
    fireEvent.click(screen.getByText('DURATION'));
    expect(props.onSort).not.toHaveBeenCalled();
  });

  it('has a divider on every column, the last one included', () => {
    setup();
    expect(screen.getAllByRole('separator')).toHaveLength(3);
  });

  it('announces the column width on its divider', () => {
    setup();
    expect(screen.getAllByRole('separator')[1]).toHaveAttribute('aria-valuenow', '340');
  });

  it('starts a resize from a divider without sorting', () => {
    const props = setup();
    const grip = screen.getAllByRole('separator')[1];
    fireEvent.pointerDown(grip, { clientX: 400, pointerId: 1 });
    fireEvent.pointerUp(grip, { clientX: 400, pointerId: 1 });
    fireEvent.click(grip);
    expect(props.onResizeStart).toHaveBeenCalledTimes(1);
    expect(vi.mocked(props.onResizeStart).mock.calls[0][1]).toBe(1);
    expect(props.onSort).not.toHaveBeenCalled();
  });

  it('autofits on a double press of the same divider', () => {
    const now = vi.spyOn(performance, 'now');
    const props = setup();
    const grip = screen.getAllByRole('separator')[1];
    now.mockReturnValue(1000);
    fireEvent.pointerDown(grip, { clientX: 400, pointerId: 1 });
    now.mockReturnValue(1100);
    fireEvent.pointerDown(grip, { clientX: 400, pointerId: 1 });
    expect(props.onResizeStart).toHaveBeenCalledTimes(1);
    expect(props.onAutofit).toHaveBeenCalledTimes(1);
    expect(props.onAutofit).toHaveBeenCalledWith(1);
    now.mockRestore();
  });

  it('treats two slow presses as two resizes', () => {
    const now = vi.spyOn(performance, 'now');
    const props = setup();
    const grip = screen.getAllByRole('separator')[1];
    now.mockReturnValue(1000);
    fireEvent.pointerDown(grip, { clientX: 400, pointerId: 1 });
    now.mockReturnValue(2000);
    fireEvent.pointerDown(grip, { clientX: 400, pointerId: 1 });
    expect(props.onResizeStart).toHaveBeenCalledTimes(2);
    expect(props.onAutofit).not.toHaveBeenCalled();
    now.mockRestore();
  });

  it('shows the sort direction on the sorted column only', () => {
    setup({ sort: { key: 'title', dir: 'desc' } });
    expect(screen.getByText('TITLE').closest('.tl-head-cell')).toHaveTextContent('▼');
    expect(screen.getByText('DURATION').closest('.tl-head-cell')).not.toHaveTextContent('▼');
  });

  it('aligns each header label like its column', () => {
    setup();
    expect(screen.getByText('DURATION').closest('.tl-head-cell')).toHaveClass('tl-cell--end');
    expect(screen.getByText('TITLE').closest('.tl-head-cell')).toHaveClass('tl-cell--start');
  });
});

describe('TracklistHeader — fixed layout', () => {
  it('has no dividers when the table borrows another table’s widths', () => {
    setup({ resizable: false });
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
    expect(screen.getByText('TITLE')).toBeInTheDocument();
  });
});

describe('TracklistHeader — moving columns', () => {
  // num 0–60, title 60–400, duration 400–492
  const RECTS: Record<string, [number, number]> = { num: [0, 60], title: [60, 400], duration: [400, 492] };

  function setupMovable() {
    vi.useFakeTimers();
    const onReorder = vi.fn();
    const props = setup({ onReorder });
    document.querySelectorAll<HTMLElement>('.tl-head-cell').forEach(cell => {
      const [left, right] = RECTS[cell.getAttribute('data-tl-col')!];
      cell.getBoundingClientRect = () => ({ left, right, width: right - left, top: 0, bottom: 30, height: 30, x: left, y: 0, toJSON: () => ({}) });
    });
    return { ...props, onReorder };
  }

  function cell(text: string) {
    return screen.getByText(text).closest('.tl-head-cell') as HTMLElement;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('moves a column after a long press and a drag', () => {
    const props = setupMovable();
    fireEvent.pointerDown(cell('DURATION'), { clientX: 450, clientY: 10, button: 0, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(400); });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 10, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 10, pointerId: 1 });
    fireEvent.click(cell('DURATION'));
    expect(props.onReorder).toHaveBeenCalledWith('duration', 'title', 'before');
    expect(props.onSort).not.toHaveBeenCalled();
  });

  it('drops behind a column when released on its right half', () => {
    const props = setupMovable();
    fireEvent.pointerDown(cell('TITLE'), { clientX: 200, clientY: 10, button: 0, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(400); });
    fireEvent.pointerMove(window, { clientX: 480, clientY: 10, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 480, clientY: 10, pointerId: 1 });
    expect(props.onReorder).toHaveBeenCalledWith('title', 'duration', 'after');
  });

  it('shows the picked-up column under the pointer while dragging', () => {
    setupMovable();
    fireEvent.pointerDown(cell('DURATION'), { clientX: 450, clientY: 10, button: 0, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(400); });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 10, pointerId: 1, buttons: 1 });
    expect(document.querySelector('.tl-drag-ghost')).toHaveTextContent('DURATION');
    expect(cell('TITLE')).toHaveClass('tl-head-cell--drop-before');
    fireEvent.pointerUp(window, { clientX: 100, clientY: 10, pointerId: 1 });
    expect(document.querySelector('.tl-drag-ghost')).toBeNull();
  });

  it('still sorts on a short click and moves nothing', () => {
    const props = setupMovable();
    fireEvent.pointerDown(cell('TITLE'), { clientX: 200, clientY: 10, button: 0, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.pointerUp(window, { clientX: 200, clientY: 10, pointerId: 1 });
    fireEvent.click(cell('TITLE'));
    expect(props.onSort).toHaveBeenCalledWith('title');
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it('does not pick up a column when the pointer moves before the long press', () => {
    const props = setupMovable();
    fireEvent.pointerDown(cell('TITLE'), { clientX: 200, clientY: 10, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 260, clientY: 10, pointerId: 1, buttons: 1 });
    act(() => { vi.advanceTimersByTime(400); });
    fireEvent.pointerMove(window, { clientX: 480, clientY: 10, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 480, clientY: 10, pointerId: 1 });
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it('never picks up the number column', () => {
    const props = setupMovable();
    fireEvent.pointerDown(cell('#'), { clientX: 30, clientY: 10, button: 0, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(400); });
    fireEvent.pointerMove(window, { clientX: 480, clientY: 10, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 480, clientY: 10, pointerId: 1 });
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it('does not sort after a long press that was released in place', () => {
    const props = setupMovable();
    fireEvent.pointerDown(cell('TITLE'), { clientX: 200, clientY: 10, button: 0, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(400); });
    fireEvent.pointerUp(window, { clientX: 200, clientY: 10, pointerId: 1 });
    fireEvent.click(cell('TITLE'));
    expect(props.onReorder).not.toHaveBeenCalled();
    expect(props.onSort).not.toHaveBeenCalled();
  });

  it('gives the page its cursor back when the header goes away during a move', () => {
    setupMovable();
    fireEvent.pointerDown(cell('DURATION'), { clientX: 450, clientY: 10, button: 0, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(400); });
    expect(document.body.style.cursor).toBe('grabbing');
    cleanup();
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });

  it('drops the move on Escape', () => {
    const props = setupMovable();
    fireEvent.pointerDown(cell('DURATION'), { clientX: 450, clientY: 10, button: 0, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(400); });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 10, pointerId: 1, buttons: 1 });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 10, pointerId: 1 });
    expect(props.onReorder).not.toHaveBeenCalled();
    expect(document.querySelector('.tl-drag-ghost')).toBeNull();
  });
});

describe('TracklistHeader — columns that show no label', () => {
  const WITH_REMOVE: readonly ColDef[] = [
    ...COLS,
    { key: 'remove', i18nKey: null, nameKey: 'favorites.removeSong', minWidth: 36, defaultWidth: 36, required: true, align: 'center' },
  ];
  const blankRemove = (col: ColDef) => (col.key === 'remove' ? '' : col.key.toUpperCase());

  afterEach(() => {
    vi.useRealTimers();
  });

  it('names the divider after the column, not its key', () => {
    setup({ cols: WITH_REMOVE, renderLabel: blankRemove });
    expect(screen.getAllByRole('separator')[3]).toHaveAttribute('aria-label', 'favorites.removeSong');
  });

  it('shows the column name under the pointer while it is moved', () => {
    vi.useFakeTimers();
    setup({ cols: WITH_REMOVE, renderLabel: blankRemove, onReorder: vi.fn() });
    const remove = document.querySelector('.tl-head-cell[data-tl-col="remove"]') as HTMLElement;
    fireEvent.pointerDown(remove, { clientX: 510, clientY: 10, button: 0, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(400); });
    expect(document.querySelector('.tl-drag-ghost')).toHaveTextContent('favorites.removeSong');
    fireEvent.pointerUp(window, { clientX: 510, clientY: 10, pointerId: 1 });
  });
});

describe('TracklistHeader — divider presses never sort', () => {
  it('does not sort when a divider press is released over the column header', () => {
    const props = setup();
    const grip = screen.getAllByRole('separator')[1];
    fireEvent.pointerDown(grip, { clientX: 400, pointerId: 1 });
    // The column grew under the pointer, so the release lands on its own header.
    fireEvent.click(screen.getByText('TITLE'));
    expect(props.onSort).not.toHaveBeenCalled();
    // The next real click on the header sorts again.
    fireEvent.pointerDown(screen.getByText('TITLE'), { clientX: 200, button: 0, pointerId: 2 });
    fireEvent.click(screen.getByText('TITLE'));
    expect(props.onSort).toHaveBeenCalledWith('title');
  });

  it('treats a quick second press somewhere else as a new resize, not an autofit', () => {
    const now = vi.spyOn(performance, 'now');
    const props = setup();
    const grip = screen.getAllByRole('separator')[1];
    now.mockReturnValue(1000);
    fireEvent.pointerDown(grip, { clientX: 400, pointerId: 1 });
    now.mockReturnValue(1100);
    fireEvent.pointerDown(grip, { clientX: 460, pointerId: 1 });
    expect(props.onResizeStart).toHaveBeenCalledTimes(2);
    expect(props.onAutofit).not.toHaveBeenCalled();
    now.mockRestore();
  });
});

describe('TracklistHeader — a lost release', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops a held column when the button is no longer down', () => {
    vi.useFakeTimers();
    const onReorder = vi.fn();
    setup({ onReorder });
    const duration = screen.getByText('DURATION').closest('.tl-head-cell') as HTMLElement;
    fireEvent.pointerDown(duration, { clientX: 450, clientY: 10, button: 0, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(400); });
    // Released outside the window: the next move arrives with no button held.
    fireEvent.pointerMove(window, { clientX: 100, clientY: 10, pointerId: 1, buttons: 0 });
    expect(document.querySelector('.tl-drag-ghost')).toBeNull();
    fireEvent.pointerUp(window, { clientX: 100, clientY: 10, pointerId: 1 });
    expect(onReorder).not.toHaveBeenCalled();
  });
});

describe('TracklistHeader — controls inside a header', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not press a button in the header after the column was held and moved', () => {
    vi.useFakeTimers();
    const onButton = vi.fn();
    const onReorder = vi.fn();
    setup({
      onReorder,
      renderLabel: col => (col.key === 'title' ? <button type="button" onClick={onButton}>TITLE</button> : col.key.toUpperCase()),
    });
    const button = screen.getByRole('button', { name: 'TITLE' });
    fireEvent.pointerDown(button, { clientX: 200, clientY: 10, button: 0, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(400); });
    fireEvent.pointerUp(window, { clientX: 200, clientY: 10, pointerId: 1 });
    fireEvent.click(button);
    expect(onButton).not.toHaveBeenCalled();
    // A plain click still reaches it.
    fireEvent.pointerDown(button, { clientX: 200, clientY: 10, button: 0, pointerId: 2 });
    fireEvent.pointerUp(window, { clientX: 200, clientY: 10, pointerId: 2 });
    fireEvent.click(button);
    expect(onButton).toHaveBeenCalledTimes(1);
  });
});

describe('TracklistHeader — focus', () => {
  // Focus left on a header after a click would make the next Space or Enter
  // sort again instead of reaching the app (play/pause) or the list.
  it('does not take focus on a mouse press', () => {
    setup();
    const cell = screen.getByText('TITLE').closest('.tl-head-cell') as HTMLElement;
    const down = createEvent.mouseDown(cell);
    fireEvent(cell, down);
    expect(down.defaultPrevented).toBe(true);
  });
});

describe('TracklistHeader — quick drags', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not sort when the header was dragged before the long press', () => {
    vi.useFakeTimers();
    const props = setup({ onReorder: vi.fn() });
    const title = screen.getByText('TITLE').closest('.tl-head-cell') as HTMLElement;
    fireEvent.pointerDown(title, { clientX: 200, clientY: 10, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 260, clientY: 10, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 260, clientY: 10, pointerId: 1 });
    fireEvent.click(title);
    expect(props.onSort).not.toHaveBeenCalled();
  });

  // The guard against the click that ends a gesture must not outlive it, or a
  // later keyboard-activated control in the header would be swallowed.
  it('lets the next click through when the gesture ended without one', () => {
    vi.useFakeTimers();
    const onButton = vi.fn();
    setup({
      renderLabel: col => (col.key === 'title' ? <button type="button" onClick={onButton}>TITLE</button> : col.key.toUpperCase()),
    });
    const grip = screen.getAllByRole('separator')[1];
    fireEvent.pointerDown(grip, { clientX: 400, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 420, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(1); });
    fireEvent.click(screen.getByRole('button', { name: 'TITLE' }));
    expect(onButton).toHaveBeenCalledTimes(1);
  });
});
