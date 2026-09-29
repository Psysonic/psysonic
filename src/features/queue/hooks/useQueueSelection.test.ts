import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, renderHook } from '@testing-library/react';
import type { QueueItemRef } from '@/lib/media/trackTypes';
import { useQueueSelection } from '@/features/queue/hooks/useQueueSelection';

const plain = { ctrlKey: false, metaKey: false, shiftKey: false };
const ctrl = { ...plain, ctrlKey: true };
const shift = { ...plain, shiftKey: true };

function refs(...ids: string[]): QueueItemRef[] {
  return ids.map(trackId => ({ serverId: 'srv', trackId }));
}

let mounted: HTMLElement[] = [];

function attach<T extends HTMLElement>(el: T): T {
  document.body.appendChild(el);
  mounted.push(el);
  return el;
}

function setup(selectable: QueueItemRef[]) {
  const list = attach(document.createElement('div'));
  const listRef = { current: list };
  const onRemove = vi.fn();
  const hook = renderHook(
    ({ items, dragging }) => useQueueSelection({ selectable: items, listRef, dragging, onRemove }),
    { initialProps: { items: selectable, dragging: false } },
  );
  return { ...hook, list, onRemove };
}

afterEach(() => {
  for (const el of mounted) el.remove();
  mounted = [];
});

describe('useQueueSelection — clicks', () => {
  it('leaves a plain click to the row while nothing is selected', () => {
    const items = refs('a', 'b');
    const { result } = setup(items);

    let consumed = true;
    act(() => { consumed = result.current.handleRowClick(items[0], plain); });

    expect(consumed).toBe(false);
    expect(result.current.inSelectMode).toBe(false);
  });

  it('toggles a row with Ctrl or Cmd and leaves select mode when the last one goes', () => {
    const items = refs('a', 'b');
    const { result } = setup(items);

    act(() => { result.current.handleRowClick(items[0], ctrl); });
    expect(result.current.isSelected(items[0]!)).toBe(true);
    expect(result.current.inSelectMode).toBe(true);

    act(() => { result.current.handleRowClick(items[1], { ...plain, metaKey: true }); });
    expect(result.current.isSelected(items[1]!)).toBe(true);

    act(() => { result.current.handleRowClick(items[0], ctrl); });
    act(() => { result.current.handleRowClick(items[1], ctrl); });
    expect(result.current.inSelectMode).toBe(false);
  });

  it('dissolves the selection on a plain click and lets that row play', () => {
    const items = refs('a', 'b', 'c');
    const { result } = setup(items);
    act(() => { result.current.handleRowClick(items[0], ctrl); });
    act(() => { result.current.handleRowClick(items[1], ctrl); });

    let consumed = true;
    act(() => { consumed = result.current.handleRowClick(items[1], plain); });

    expect(consumed).toBe(false);
    expect(result.current.inSelectMode).toBe(false);
  });

  it('selects the range from the last Ctrl-clicked row on Shift, replacing the selection', () => {
    const items = refs('a', 'b', 'c', 'd', 'e');
    const { result } = setup(items);
    act(() => { result.current.handleRowClick(items[4], ctrl); });
    act(() => { result.current.handleRowClick(items[1], ctrl); });

    act(() => { result.current.handleRowClick(items[3], shift); });
    expect(items.map(ref => result.current.isSelected(ref))).toEqual([false, true, true, true, false]);

    // The anchor stays on the Ctrl-clicked row, so a second Shift+click re-ranges from it.
    act(() => { result.current.handleRowClick(items[0], shift); });
    expect(items.map(ref => result.current.isSelected(ref))).toEqual([true, true, false, false, false]);
  });

  it('starts with just the clicked row on Shift without an anchor', () => {
    const items = refs('a', 'b', 'c');
    const { result } = setup(items);

    act(() => { result.current.handleRowClick(items[2], shift); });
    expect(items.map(ref => result.current.isSelected(ref))).toEqual([false, false, true]);

    act(() => { result.current.handleRowClick(items[0], shift); });
    expect(items.map(ref => result.current.isSelected(ref))).toEqual([true, true, true]);
  });

  it('does not range from a plain-clicked row', () => {
    const items = refs('a', 'b', 'c');
    const { result } = setup(items);
    act(() => { result.current.handleRowClick(items[0], ctrl); });
    act(() => { result.current.handleRowClick(items[0], plain); });

    act(() => { result.current.handleRowClick(items[2], shift); });

    expect(items.map(ref => result.current.isSelected(ref))).toEqual([false, false, true]);
  });

  it('keeps two copies of the same track apart', () => {
    const [first, copy] = refs('dup', 'dup');
    const { result } = setup([first!, copy!]);

    act(() => { result.current.handleRowClick(copy, ctrl); });

    expect(result.current.isSelected(copy!)).toBe(true);
    expect(result.current.isSelected(first!)).toBe(false);
  });

  it('ignores Ctrl/Shift clicks on rows that cannot be selected', () => {
    const items = refs('a', 'b');
    const playingRow = { serverId: 'srv', trackId: 'playing' };
    const { result } = setup(items);
    act(() => { result.current.handleRowClick(items[0], ctrl); });

    let consumed = false;
    act(() => { consumed = result.current.handleRowClick(playingRow, ctrl); });
    expect(consumed).toBe(true);
    act(() => { consumed = result.current.handleRowClick(undefined, shift); });
    expect(consumed).toBe(true);
    expect(items.map(ref => result.current.isSelected(ref))).toEqual([true, false]);
  });
});

describe('useQueueSelection — drag', () => {
  it('hands over the whole selection in display order when a selected row is grabbed', () => {
    const items = refs('a', 'b', 'c', 'd');
    const { result } = setup(items);
    act(() => { result.current.handleRowClick(items[3], ctrl); });
    act(() => { result.current.handleRowClick(items[1], ctrl); });

    let block: QueueItemRef[] | null = null;
    act(() => { block = result.current.dragBlock(items[3]!); });

    expect(block).toEqual([items[1], items[3]]);
  });

  it('keeps the selection through the drag and drops it when the drag ends', () => {
    const items = refs('a', 'b', 'c');
    const { result, rerender } = setup(items);
    act(() => { result.current.handleRowClick(items[0], ctrl); });
    act(() => { result.current.handleRowClick(items[1], ctrl); });
    act(() => { result.current.dragBlock(items[1]!); });

    rerender({ items, dragging: true });
    expect(result.current.inSelectMode).toBe(true);

    rerender({ items, dragging: false });
    expect(result.current.inSelectMode).toBe(false);
  });

  it('drops a single selected row once its drag ends', () => {
    const items = refs('a', 'b');
    const { result, rerender } = setup(items);
    act(() => { result.current.handleRowClick(items[1], ctrl); });

    let block: QueueItemRef[] | null = [];
    act(() => { block = result.current.dragBlock(items[1]!); });
    expect(block).toBeNull();

    rerender({ items, dragging: true });
    rerender({ items, dragging: false });
    expect(result.current.inSelectMode).toBe(false);
  });

  it('dissolves the selection at once when an unselected row is grabbed', () => {
    const items = refs('a', 'b', 'c');
    const { result } = setup(items);
    act(() => { result.current.handleRowClick(items[0], ctrl); });
    act(() => { result.current.handleRowClick(items[1], ctrl); });

    let block: QueueItemRef[] | null = [];
    act(() => { block = result.current.dragBlock(items[2]!); });

    expect(block).toBeNull();
    expect(result.current.inSelectMode).toBe(false);
  });

  it('leaves a later, unrelated selection alone after a drag without one', () => {
    const items = refs('a', 'b');
    const { result, rerender } = setup(items);
    rerender({ items, dragging: true });
    rerender({ items, dragging: false });

    act(() => { result.current.handleRowClick(items[0], ctrl); });

    expect(result.current.inSelectMode).toBe(true);
  });
});

describe('useQueueSelection — keys and outside clicks', () => {
  it('keeps the selection after Ctrl is released, so Delete still reaches it', () => {
    const items = refs('a', 'b');
    const { result, onRemove } = setup(items);
    act(() => { result.current.handleRowClick(items[0], ctrl); });

    act(() => { fireEvent.keyUp(document.body, { key: 'Control' }); });
    expect(result.current.inSelectMode).toBe(true);

    act(() => { fireEvent.keyDown(document.body, { key: 'Delete' }); });
    expect(onRemove).toHaveBeenCalledWith([items[0]]);
  });

  it('removes the selection in display order on Delete and clears it', () => {
    const items = refs('a', 'b', 'c');
    const { result, onRemove } = setup(items);
    act(() => { result.current.handleRowClick(items[2], ctrl); });
    act(() => { result.current.handleRowClick(items[0], ctrl); });

    act(() => { fireEvent.keyDown(document.body, { key: 'Delete', ctrlKey: true }); });

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove.mock.calls[0]![0]).toEqual([items[0], items[2]]);
    expect(onRemove.mock.calls[0]![0][0]).toBe(items[0]);
    expect(result.current.inSelectMode).toBe(false);
  });

  it('removes on Cmd+Backspace and Shift+Delete, but not with Alt', () => {
    const items = refs('a', 'b');
    const { result, onRemove } = setup(items);
    act(() => { result.current.handleRowClick(items[1], ctrl); });

    act(() => { fireEvent.keyDown(document.body, { key: 'Backspace', altKey: true }); });
    expect(onRemove).not.toHaveBeenCalled();

    act(() => { fireEvent.keyDown(document.body, { key: 'Backspace', metaKey: true }); });
    expect(onRemove).toHaveBeenLastCalledWith([items[1]]);

    act(() => { result.current.handleRowClick(items[0], shift); });
    act(() => { fireEvent.keyDown(document.body, { key: 'Delete', shiftKey: true }); });
    expect(onRemove).toHaveBeenLastCalledWith([items[0]]);
  });

  it('ignores Delete typed into a text field', () => {
    const items = refs('a');
    const { result, onRemove } = setup(items);
    const input = attach(document.createElement('input'));
    act(() => { result.current.handleRowClick(items[0], ctrl); });

    act(() => { fireEvent.keyDown(input, { key: 'Delete', ctrlKey: true }); });

    expect(onRemove).not.toHaveBeenCalled();
    expect(result.current.inSelectMode).toBe(true);
  });

  it('does nothing on Delete without a selection', () => {
    const { onRemove } = setup(refs('a'));

    act(() => { fireEvent.keyDown(document.body, { key: 'Delete' }); });

    expect(onRemove).not.toHaveBeenCalled();
  });

  it('clears on Escape', () => {
    const items = refs('a');
    const { result, onRemove } = setup(items);
    act(() => { result.current.handleRowClick(items[0], ctrl); });

    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }); });

    expect(result.current.inSelectMode).toBe(false);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('clears on a mousedown outside the list, but not inside it or in the row menu', () => {
    const items = refs('a');
    const { result, list } = setup(items);
    const row = list.appendChild(document.createElement('div'));
    const menu = attach(document.createElement('div'));
    menu.className = 'context-menu';
    const menuItem = menu.appendChild(document.createElement('div'));
    const elsewhere = attach(document.createElement('div'));
    act(() => { result.current.handleRowClick(items[0], ctrl); });

    act(() => { fireEvent.mouseDown(row); });
    act(() => { fireEvent.mouseDown(menuItem); });
    expect(result.current.inSelectMode).toBe(true);

    act(() => { fireEvent.mouseDown(elsewhere); });
    expect(result.current.inSelectMode).toBe(false);
  });

  it('drops entries that leave the list', () => {
    const items = refs('a', 'b');
    const { result, rerender } = setup(items);
    act(() => { result.current.handleRowClick(items[0], ctrl); });

    rerender({ items: [items[1]!], dragging: false });

    expect(result.current.inSelectMode).toBe(false);
    expect(result.current.isSelected(items[0]!)).toBe(false);
  });
});
