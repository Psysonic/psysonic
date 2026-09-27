import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { useTrackListCursor } from './useTrackListCursor';

interface HarnessProps {
  keys: string[];
  onActivate?: (index: number) => void;
  scrollToIndex?: (index: number) => void;
}

function Harness({ keys, onActivate = () => {}, scrollToIndex }: HarnessProps) {
  const cursor = useTrackListCursor({ keys, onActivate, scrollToIndex });
  return (
    <div data-testid="list" {...cursor.listProps}>
      {keys.map((key, i) => (
        <div
          key={`${key}:${i}`}
          data-testid={`row-${i}`}
          id={cursor.cursorIndex === i ? cursor.cursorRowId : undefined}
          data-cursor={cursor.cursorIndex === i ? 'yes' : undefined}
          onClick={e => cursor.setCursorFromClick(i, e)}
        >
          {key}
          <button type="button">play {key}</button>
        </div>
      ))}
      <input data-testid="filter" />
    </div>
  );
}

function renderList(props: HarnessProps) {
  const utils = render(<Harness {...props} />);
  const list = utils.getByTestId('list');
  const cursorRow = () => utils.container.querySelector('[data-cursor="yes"]')?.getAttribute('data-testid') ?? null;
  return { ...utils, list, cursorRow };
}

describe('useTrackListCursor', () => {
  it('puts the cursor on a clicked row and focuses the list', () => {
    const { list, getByTestId, cursorRow } = renderList({ keys: ['a', 'b', 'c'] });
    fireEvent.click(getByTestId('row-1'));
    expect(cursorRow()).toBe('row-1');
    expect(document.activeElement).toBe(list);
  });

  it('moves with the arrow keys, Home and End, and stops at the ends', () => {
    const { list, cursorRow } = renderList({ keys: ['a', 'b', 'c'] });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(cursorRow()).toBe('row-0');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(cursorRow()).toBe('row-2');
    fireEvent.keyDown(list, { key: 'Home' });
    expect(cursorRow()).toBe('row-0');
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(cursorRow()).toBe('row-0');
    fireEvent.keyDown(list, { key: 'End' });
    expect(cursorRow()).toBe('row-2');
  });

  it('starts from the last row when ArrowUp comes first', () => {
    const { list, cursorRow } = renderList({ keys: ['a', 'b', 'c'] });
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(cursorRow()).toBe('row-2');
  });

  it('plays the cursor row on Enter and does nothing without a cursor', () => {
    const onActivate = vi.fn();
    const { list, getByTestId } = renderList({ keys: ['a', 'b', 'c'], onActivate });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onActivate).not.toHaveBeenCalled();

    fireEvent.click(getByTestId('row-2'));
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledOnce();
    expect(onActivate).toHaveBeenCalledWith(2);
  });

  it('leaves Enter to a focused button inside a row', () => {
    const onActivate = vi.fn();
    const { getByTestId, getByText } = renderList({ keys: ['a', 'b'], onActivate });
    fireEvent.click(getByTestId('row-0'));
    fireEvent.keyDown(getByText('play a'), { key: 'Enter' });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('ignores keys typed into a field and keys held with a modifier', () => {
    const onActivate = vi.fn();
    const { list, getByTestId, cursorRow } = renderList({ keys: ['a', 'b'], onActivate });
    fireEvent.keyDown(getByTestId('filter'), { key: 'ArrowDown' });
    expect(cursorRow()).toBeNull();
    fireEvent.keyDown(list, { key: 'ArrowDown', ctrlKey: true });
    fireEvent.keyDown(list, { key: 'ArrowDown', shiftKey: true });
    expect(cursorRow()).toBeNull();
  });

  it('drops the cursor on Escape', () => {
    const { list, getByTestId, cursorRow } = renderList({ keys: ['a', 'b'] });
    fireEvent.click(getByTestId('row-1'));
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(cursorRow()).toBeNull();
  });

  it('keeps its keys away from app-wide listeners it handled, and only those', () => {
    const windowKeys: string[] = [];
    const onWindowKey = (e: KeyboardEvent) => windowKeys.push(e.key);
    window.addEventListener('keydown', onWindowKey);
    try {
      const { list } = renderList({ keys: ['a', 'b'] });
      fireEvent.keyDown(list, { key: 'ArrowDown' });
      fireEvent.keyDown(list, { key: 'Enter' });
      fireEvent.keyDown(list, { key: ' ' });
      expect(windowKeys).toEqual([' ']);
    } finally {
      window.removeEventListener('keydown', onWindowKey);
    }
  });

  it('follows its track when the order changes and lets go when it leaves', () => {
    const { getByTestId, cursorRow, rerender } = renderList({ keys: ['a', 'b', 'c'] });
    fireEvent.click(getByTestId('row-1'));
    rerender(<Harness keys={['c', 'a', 'b']} />);
    expect(cursorRow()).toBe('row-2');
    rerender(<Harness keys={['c', 'a']} />);
    expect(cursorRow()).toBeNull();
  });

  it('stays on the second copy of a track that appears twice', () => {
    const { list, getByTestId, cursorRow } = renderList({ keys: ['a', 'b', 'a'] });
    fireEvent.click(getByTestId('row-2'));
    expect(cursorRow()).toBe('row-2');
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(cursorRow()).toBe('row-2');
  });

  it('asks a virtualised list to scroll on keyboard moves, not on clicks', () => {
    const scrollToIndex = vi.fn();
    const { list, getByTestId } = renderList({ keys: ['a', 'b', 'c'], scrollToIndex });
    fireEvent.click(getByTestId('row-0'));
    expect(scrollToIndex).not.toHaveBeenCalled();
    fireEvent.keyDown(list, { key: 'End' });
    expect(scrollToIndex).toHaveBeenCalledWith(2);
  });
});
