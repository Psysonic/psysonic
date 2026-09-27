import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';

interface CursorPos {
  index: number;
  key: string;
}

interface UseTrackListCursorArgs {
  /** Row identity in display order. The same key may appear twice (a playlist can hold a track twice). */
  keys: readonly string[];
  /** The row's play action — whatever a double click does there (or a single click in single-click mode). */
  onActivate: (index: number) => void;
  /**
   * Virtualised lists: bring the row at `index` into view through the virtualiser,
   * since a row outside the rendered window has no element to scroll to.
   */
  scrollToIndex?: (index: number) => void;
}

export interface TrackListCursor {
  cursorIndex: number | null;
  /** DOM id the cursor row carries; only that one row gets it. */
  cursorRowId: string;
  /** Pointer path: moves the cursor to the clicked row and hands the list keyboard focus. */
  setCursorFromClick: (index: number, e: React.MouseEvent) => void;
  /** Spread onto the list container. */
  listProps: {
    tabIndex: number;
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
    'data-track-cursor-list': '';
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Where the cursor sits now. Held as index + key so it follows its track through a
 * re-sort or a newly loaded page, and still tells two copies of one track apart
 * while the order stays put. A track that left the list takes the cursor with it.
 */
function resolveCursor(pos: CursorPos | null, keys: readonly string[]): number | null {
  if (!pos) return null;
  if (keys[pos.index] === pos.key) return pos.index;
  const moved = keys.indexOf(pos.key);
  return moved >= 0 ? moved : null;
}

/**
 * One highlighted row per tracklist, separate from the Ctrl/Shift multi-selection:
 * a click puts it on a row, ↑/↓/Home/End move it, Enter plays it, Escape drops it.
 * The keys only act while the list has focus, so they never compete with the
 * app-wide shortcuts elsewhere.
 */
export function useTrackListCursor({ keys, onActivate, scrollToIndex }: UseTrackListCursorArgs): TrackListCursor {
  const cursorRowId = useId();
  const [pos, setPos] = useState<CursorPos | null>(null);
  const cursorIndex = useMemo(() => resolveCursor(pos, keys), [pos, keys]);
  const scrollPendingRef = useRef(false);

  const latest = useRef({ keys, cursorIndex, onActivate, scrollToIndex });
  // React Compiler refs rule: ref kept in sync with the latest value for use in event handlers; not render data.
  // eslint-disable-next-line react-hooks/refs
  latest.current = { keys, cursorIndex, onActivate, scrollToIndex };

  useLayoutEffect(() => {
    if (!scrollPendingRef.current || cursorIndex === null) return;
    scrollPendingRef.current = false;
    document.getElementById(cursorRowId)?.scrollIntoView({ block: 'nearest' });
  }, [cursorIndex, cursorRowId]);

  const setCursorFromClick = useCallback((index: number, e: React.MouseEvent) => {
    const key = latest.current.keys[index];
    if (key === undefined) return;
    setPos({ index, key });
    // Rows swallow mousedown for drag-and-drop, so the click alone does not move focus.
    const list = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-track-cursor-list]');
    if (list && !list.contains(document.activeElement)) list.focus({ preventScroll: true });
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (isEditableTarget(e.target)) return;
    const { keys: rowKeys, cursorIndex: at, onActivate: activate, scrollToIndex: scrollTo } = latest.current;
    const count = rowKeys.length;
    if (count === 0) return;

    let next: number;
    switch (e.key) {
      case 'ArrowDown': next = at === null ? 0 : Math.min(count - 1, at + 1); break;
      case 'ArrowUp': next = at === null ? count - 1 : Math.max(0, at - 1); break;
      case 'Home': next = 0; break;
      case 'End': next = count - 1; break;
      case 'Enter':
        if (at === null) return;
        // A focused button inside a row answers its own Enter.
        if (e.target !== e.currentTarget && (e.target as HTMLElement).closest('button, a')) return;
        e.preventDefault();
        e.stopPropagation();
        activate(at);
        return;
      case 'Escape':
        if (at === null) return;
        e.preventDefault();
        e.stopPropagation();
        setPos(null);
        return;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    scrollPendingRef.current = true;
    setPos({ index: next, key: rowKeys[next] });
    scrollTo?.(next);
  }, []);

  return {
    cursorIndex,
    cursorRowId,
    setCursorFromClick,
    listProps: { tabIndex: 0, onKeyDown, 'data-track-cursor-list': '' },
  };
}
