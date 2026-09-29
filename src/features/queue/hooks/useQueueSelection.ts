import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { QueueItemRef } from '@/lib/media/trackTypes';

interface RowClickModifiers {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

interface UseQueueSelectionArgs {
  /** Rows that can be selected, in display order. The playing entry and timeline history are left out. */
  selectable: readonly QueueItemRef[];
  listRef: React.RefObject<HTMLElement | null>;
  /** True while a queue row is being dragged. */
  dragging: boolean;
  onRemove: (refs: QueueItemRef[]) => void;
}

export interface QueueSelection {
  inSelectMode: boolean;
  isSelected: (ref: QueueItemRef) => boolean;
  /** Returns true when the click belongs to the selection and must not play the row. */
  handleRowClick: (ref: QueueItemRef | undefined, modifiers: RowClickModifiers) => boolean;
  /**
   * Called when a drag starts on `ref`. Returns the entries that move together
   * when `ref` belongs to a selection of two or more, otherwise null. Grabbing an
   * unselected row drops the selection at once; grabbing a selected one drops it
   * once the drag ends.
   */
  dragBlock: (ref: QueueItemRef) => QueueItemRef[] | null;
  clear: () => void;
}

const NO_SELECTION: ReadonlySet<QueueItemRef> = new Set();

function isEditableKeyTarget(e: KeyboardEvent): boolean {
  for (const node of e.composedPath()) {
    if (!(node instanceof HTMLElement)) continue;
    const tag = node.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (node.isContentEditable) return true;
  }
  return false;
}

/**
 * Multi-select for the queue list: Ctrl/Cmd+click toggles a row, Shift+click
 * selects the range from the last Ctrl/Shift-clicked row. The selection outlives
 * the key, so Delete (or Backspace, the key macOS labels "delete") can remove it
 * afterwards, with or without the key still held. A drag on a selected row moves
 * it as a block. A plain click stays a click — the row plays and the selection
 * dissolves — and Escape, a mousedown outside the list or the end of a drag clear it too.
 *
 * The selection holds the queue entries themselves rather than their positions:
 * the same track can sit in the queue twice, and an insert above the selection
 * would otherwise shift it onto rows the user never picked.
 */
export function useQueueSelection({
  selectable,
  listRef,
  dragging,
  onRemove,
}: UseQueueSelectionArgs): QueueSelection {
  const [picked, setPicked] = useState<ReadonlySet<QueueItemRef>>(NO_SELECTION);
  const anchorRef = useRef<QueueItemRef | null>(null);
  const clearAfterDragRef = useRef(false);

  const positions = useMemo(() => {
    const map = new Map<QueueItemRef, number>();
    selectable.forEach((ref, i) => map.set(ref, i));
    return map;
  }, [selectable]);

  // Entries that left the list (played past in queue mode, removed elsewhere)
  // drop out on their own instead of keeping select mode alive.
  const selected = useMemo(() => {
    if (picked.size === 0) return picked;
    const live = new Set([...picked].filter(ref => positions.has(ref)));
    return live.size === picked.size ? picked : live;
  }, [picked, positions]);

  const inSelectMode = selected.size > 0;

  const clear = useCallback(() => {
    anchorRef.current = null;
    setPicked(NO_SELECTION);
  }, []);

  const isSelected = useCallback((ref: QueueItemRef) => selected.has(ref), [selected]);

  const handleRowClick = useCallback((ref: QueueItemRef | undefined, modifiers: RowClickModifiers) => {
    const toggle = modifiers.ctrlKey || modifiers.metaKey;
    if (!toggle && !modifiers.shiftKey) {
      anchorRef.current = null;
      if (picked.size > 0) setPicked(NO_SELECTION);
      return false;
    }
    if (!ref || !positions.has(ref)) return true;

    if (toggle) {
      const next = new Set(selected);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      anchorRef.current = ref;
      setPicked(next);
      return true;
    }

    // Shift: the range from the anchor replaces the selection, and the anchor
    // stays put so a second Shift+click re-ranges from the same row.
    const anchor = anchorRef.current;
    const anchorAt = anchor ? positions.get(anchor) : undefined;
    if (anchorAt === undefined) {
      anchorRef.current = ref;
      setPicked(new Set([ref]));
      return true;
    }
    const at = positions.get(ref)!;
    setPicked(new Set(selectable.slice(Math.min(anchorAt, at), Math.max(anchorAt, at) + 1)));
    return true;
  }, [picked, positions, selected, selectable]);

  const dragBlock = useCallback((ref: QueueItemRef) => {
    if (!selected.has(ref)) {
      if (picked.size > 0) clear();
      return null;
    }
    clearAfterDragRef.current = true;
    return selected.size > 1 ? selectable.filter(entry => selected.has(entry)) : null;
  }, [selected, selectable, picked, clear]);

  // The drag flag flips on right after `dragBlock` and off once the rows were
  // dropped (or the drag was cancelled) — that moment ends the selection.
  useEffect(() => {
    if (dragging || !clearAfterDragRef.current) return;
    clearAfterDragRef.current = false;
    clear();
  }, [dragging, clear]);

  useEffect(() => {
    if (!inSelectMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditableKeyTarget(e)) return;
      if (e.key === 'Escape') {
        clear();
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      const refs = selectable.filter(ref => selected.has(ref));
      clear();
      onRemove(refs);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [inSelectMode, selectable, selected, clear, onRemove]);

  useEffect(() => {
    if (!inSelectMode) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node) || listRef.current?.contains(target)) return;
      // The row context menu is portalled out of the list but acts on its rows.
      if (target instanceof Element && target.closest('.context-menu')) return;
      clear();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [inSelectMode, listRef, clear]);

  return { inSelectMode, isSelected, handleRowClick, dragBlock, clear };
}
