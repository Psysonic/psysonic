/**
 * Covers the click a drag leaves behind. Dropping a queue row used to start the
 * track, because the browser still fires `click` after the drag's `mouseup`
 * whenever press and release share an ancestor — for a reorder inside one list,
 * usually the row itself (issue #1592).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DragDropProvider, useDragDrop } from '@/lib/dnd/DragDropContext';

const rowClicked = vi.fn();

function Harness() {
  const { startDrag, isDragging } = useDragDrop();
  return (
    <div>
      <button type="button" onClick={rowClicked}>row</button>
      <button
        type="button"
        onClick={() => startDrag({ data: '{"type":"queue_reorder","index":0}', label: 'x' }, 10, 10)}
      >
        begin
      </button>
      <span data-testid="state">{isDragging ? 'dragging' : 'idle'}</span>
    </div>
  );
}

const renderHarness = () => render(<DragDropProvider><Harness /></DragDropProvider>);
const row = () => screen.getByText('row');

/** Lets the queued microtask/timer that releases the click guard run. */
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

function startAndDrop(): void {
  act(() => { fireEvent.click(screen.getByText('begin')); });
  expect(screen.getByTestId('state')).toHaveTextContent('dragging');
  act(() => { fireEvent.mouseUp(document); });
  expect(screen.getByTestId('state')).toHaveTextContent('idle');
}

beforeEach(async () => {
  // A test that left a drag running hands its click guard on, and the library
  // unmounts it only after that test finished — so the release is settled here,
  // where it is guaranteed to have happened.
  await settle();
  rowClicked.mockClear();
  // jsdom does no hit testing, and the drop dispatch needs a target to fire at.
  document.elementFromPoint = () => document.body;
});

describe('DragDropProvider — the click after a drag', () => {
  it('lets an ordinary click through when no drag happened', () => {
    renderHarness();

    fireEvent.click(row());

    expect(rowClicked).toHaveBeenCalledTimes(1);
  });

  it('swallows the click the browser fires after a drop', () => {
    renderHarness();

    startAndDrop();
    fireEvent.click(row());

    expect(rowClicked).not.toHaveBeenCalled();
  });

  it('swallows a click during the drag as well', () => {
    renderHarness();
    act(() => { fireEvent.click(screen.getByText('begin')); });

    fireEvent.click(row());

    expect(rowClicked).not.toHaveBeenCalled();
  });

  // The guard outlives the drag by one turn of the event loop and no longer,
  // or it would start eating the clicks that come after it.
  it('releases in time for the next real click', async () => {
    renderHarness();
    startAndDrop();
    fireEvent.click(row());
    expect(rowClicked).not.toHaveBeenCalled();

    await settle();
    fireEvent.click(row());

    expect(rowClicked).toHaveBeenCalledTimes(1);
  });

  it('releases after a drag cancelled with Escape too', async () => {
    renderHarness();
    act(() => { fireEvent.click(screen.getByText('begin')); });
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(screen.getByTestId('state')).toHaveTextContent('idle');

    await settle();
    fireEvent.click(row());

    expect(rowClicked).toHaveBeenCalledTimes(1);
  });
});
