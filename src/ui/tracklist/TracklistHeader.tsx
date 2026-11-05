import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TFunction } from 'i18next';
import type { ColDef } from '@/lib/hooks/useTracklistColumns';
import { TracklistHeaderMenu, type TracklistMenuConfig } from '@/ui/tracklist/TracklistHeaderMenu';
import { columnLabelKey } from '@/ui/tracklist/columnLabel';
import { columnAlign } from '@/ui/tracklist/columnAlign';

/** Two presses on the same divider within this time are a double-click (autofit). */
const DOUBLE_PRESS_MS = 450;
/** Holding a header this long picks the column up for moving. */
const LONG_PRESS_MS = 350;
/** Moving further than this before the long press means the user is not holding still. */
const HOLD_SLOP_PX = 6;
/** A second divider press only counts as a double-click this close to the first one. */
const DOUBLE_PRESS_SLOP_PX = 4;
/** Keyboard resize steps on a focused divider: arrow, Shift+arrow. */
const KEY_STEP_PX = 10;
const KEY_STEP_BIG_PX = 50;

type DropSide = 'before' | 'after';

export interface TracklistHeaderProps {
  cols: readonly ColDef[];
  gridStyle: React.CSSProperties;
  /** Content of a header cell; the sort arrow and the divider are added here. */
  renderLabel: (col: ColDef) => React.ReactNode;
  sort?: { key: string; dir: 'asc' | 'desc' } | null;
  isSortable?: (key: string) => boolean;
  onSort?: (key: string) => void;
  onResizeStart: (e: React.PointerEvent, colIndex: number) => void;
  onAutofit: (colIndex: number) => void;
  /** Keyboard resize of a focused divider. Without it, the arrow keys do nothing there. */
  onResizeBy?: (colIndex: number, deltaPx: number) => void;
  widthOf: (key: string) => number;
  t: TFunction;
  /** False for a table that shows another table's widths (playlist suggestions): no dividers. */
  resizable?: boolean;
  /** Drop `key` before or after `targetKey`. Without it, columns cannot be moved. */
  onReorder?: (key: string, targetKey: string, side: DropSide) => void;
  /** Right-click menu: column chooser, fit all, reset. Without it, no menu. */
  menu?: TracklistMenuConfig;
  /** `aria-sort` per column, for tables whose sorting the header does not drive itself. */
  ariaSortOf?: (key: string) => 'ascending' | 'descending' | 'none' | undefined;
  /** Extra classes on a header cell (table-specific styling hooks). */
  headCellClassName?: (col: ColDef) => string;
  /** `aria-rowindex` of the header row, for tables whose rows carry one (virtualised `role="table"`). */
  ariaRowIndex?: number;
}

interface HoldState {
  key: string;
  label: string;
  startX: number;
  startY: number;
  timer: number;
  active: boolean;
}

interface DragView {
  key: string;
  label: string;
  x: number;
  y: number;
  target: { key: string; side: DropSide } | null;
}

function columnName(col: ColDef, t: TFunction): string {
  if (col.i18nKey) return t(columnLabelKey(col.i18nKey));
  if (col.nameKey) return t(col.nameKey);
  return col.key === 'num' ? '#' : col.key;
}

/** Time of a divider press, for the double-press check. Only ever called from an event handler. */
function pressTime(): number {
  return performance.now();
}

/**
 * Header row of a track table.
 *
 * - Every column has a divider on its right edge that sits exactly on the
 *   column boundary: drag it to resize only that column, press it twice to fit
 *   the column to its content.
 * - Clicking a sortable header sorts; a press on a divider never does.
 * - Holding a header picks the column up; drag it and let go to move it. The
 *   number column stays first.
 */
export function TracklistHeader({
  cols, gridStyle, renderLabel, sort, isSortable, onSort,
  onResizeStart, onAutofit, onResizeBy, widthOf, t, resizable = true, onReorder, menu,
  ariaSortOf, headCellClassName, ariaRowIndex,
}: TracklistHeaderProps) {
  // A column moved by keyboard keeps the focus on its new place.
  const refocusKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    const key = refocusKey.current;
    if (!key) return;
    refocusKey.current = null;
    rowRef.current?.querySelector<HTMLElement>(`.tl-head-cell[data-tl-col="${CSS.escape(key)}"]`)?.focus();
  }, [cols]);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; key: string | null } | null>(null);
  const closeMenu = useCallback(() => setMenuAt(null), []);
  const rowRef = useRef<HTMLDivElement>(null);
  // The divider element can be re-rendered between two presses (its width
  // label changes while dragging), so a native dblclick would not reliably
  // land on the same node. Track the double press ourselves.
  const lastPress = useRef<{ index: number; at: number; x: number } | null>(null);
  const hold = useRef<HoldState | null>(null);
  // A long press ends with a click on the header; that click must not sort.
  const swallowClick = useRef(false);
  const [drag, setDrag] = useState<DragView | null>(null);
  const dragRef = useRef<DragView | null>(null);

  const onGripPointerDown = (e: React.PointerEvent, index: number) => {
    e.stopPropagation();
    // The release usually lands somewhere else than the press (the column moved
    // under the pointer), and then the browser clicks the common ancestor —
    // often this column's own header. That click must not sort.
    swallowClick.current = true;
    const now = pressTime();
    const prev = lastPress.current;
    if (
      prev && prev.index === index && now - prev.at < DOUBLE_PRESS_MS
      && Math.abs(e.clientX - prev.x) <= DOUBLE_PRESS_SLOP_PX
    ) {
      lastPress.current = null;
      e.preventDefault();
      onAutofit(index);
      return;
    }
    lastPress.current = { index, at: now, x: e.clientX };
    onResizeStart(e, index);
  };

  const dropTarget = useCallback((x: number, dragKey: string): DragView['target'] => {
    const row = rowRef.current;
    if (!row) return null;
    const cells = Array.from(row.querySelectorAll<HTMLElement>('.tl-head-cell'));
    if (cells.length === 0) return null;
    let hit = cells.find(cell => {
      const r = cell.getBoundingClientRect();
      return x >= r.left && x < r.right;
    });
    if (!hit) {
      const first = cells[0].getBoundingClientRect();
      hit = x < first.left ? cells[0] : cells[cells.length - 1];
    }
    const key = hit.getAttribute('data-tl-col') ?? '';
    if (!key || key === dragKey) return null;
    const r = hit.getBoundingClientRect();
    const side: DropSide = key === 'num' || x >= r.left + r.width / 2 ? 'after' : 'before';
    return { key, side };
  }, []);

  const endHold = useCallback(() => {
    const h = hold.current;
    if (h) window.clearTimeout(h.timer);
    hold.current = null;
    dragRef.current = null;
    setDrag(null);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  // Window listeners: a held press is followed wherever the pointer goes.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const h = hold.current;
      if (!h) return;
      // The release got lost (let go outside the window): no button is down any more.
      if (e.buttons === 0) {
        endHold();
        return;
      }
      if (!h.active) {
        if (Math.abs(e.clientX - h.startX) > HOLD_SLOP_PX || Math.abs(e.clientY - h.startY) > HOLD_SLOP_PX) {
          // A drag that started before the long press is neither a move nor a click.
          swallowClick.current = true;
          endHold();
        }
        return;
      }
      const view: DragView = { key: h.key, label: h.label, x: e.clientX, y: e.clientY, target: dropTarget(e.clientX, h.key) };
      dragRef.current = view;
      setDrag(view);
    };
    const onUp = () => {
      // The click that ends this gesture arrives right after the release; once
      // that is past, the guard must not eat a later, unrelated click.
      if (swallowClick.current) window.setTimeout(() => { swallowClick.current = false; }, 0);
      const h = hold.current;
      if (!h) return;
      if (h.active) {
        swallowClick.current = true;
        window.setTimeout(() => { swallowClick.current = false; }, 0);
        const target = dragRef.current?.target;
        if (target && onReorder) onReorder(h.key, target.key, target.side);
      }
      endHold();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && hold.current?.active) {
        swallowClick.current = true;
        endHold();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', endHold);
    // Capture phase: Escape must cancel a held column even when a list below
    // would otherwise use it first.
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', endHold);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [dropTarget, endHold, onReorder]);

  // Never leave a timer behind, nor the page cursor of a column held while the
  // table went away.
  useEffect(() => () => {
    const h = hold.current;
    if (!h) return;
    window.clearTimeout(h.timer);
    if (h.active) {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  }, []);

  const onCellPointerDown = (e: React.PointerEvent, col: ColDef) => {
    // A fresh press on a header starts clean, whatever the last gesture was.
    swallowClick.current = false;
    if (!onReorder || col.key === 'num' || e.button !== 0) return;
    const label = columnName(col, t);
    const timer = window.setTimeout(() => {
      const h = hold.current;
      if (!h || h.key !== col.key) return;
      h.active = true;
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      const view: DragView = { key: h.key, label: h.label, x: h.startX, y: h.startY, target: null };
      dragRef.current = view;
      setDrag(view);
    }, LONG_PRESS_MS);
    hold.current = { key: col.key, label, startX: e.clientX, startY: e.clientY, timer, active: false };
  };

  /** Move `key` one place left (-1) or right (+1); `null` when that is not possible. */
  const neighbourMove = (key: string | null, step: -1 | 1): (() => void) | undefined => {
    if (!onReorder || !key || key === 'num') return undefined;
    const at = cols.findIndex(c => c.key === key);
    const neighbour = cols[at + step];
    if (at < 0 || !neighbour || neighbour.key === 'num') return undefined;
    return () => onReorder(key, neighbour.key, step < 0 ? 'before' : 'after');
  };

  const onHeaderContextMenu = (e: React.MouseEvent) => {
    if (!menu) return;
    e.preventDefault();
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.tl-head-cell');
    setMenuAt({ x: e.clientX, y: e.clientY, key: cell?.getAttribute('data-tl-col') ?? null });
  };

  // Keys a header or divider handles stop here, so the list's row cursor and
  // the app shortcuts never see them. Alt combinations (back/forward) pass.
  const onCellKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, col: ColDef, sortable: boolean) => {
    if (e.altKey) return;
    // A focused divider handles its own keys; whatever it leaves (Space) goes to the app.
    if ((e.target as Element).closest('.tl-grip')) return;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if ((e.key === 'Enter' || e.key === ' ') && !e.ctrlKey && !e.metaKey) {
      if (sortable) { handled(); onSort?.(col.key); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const move = neighbourMove(col.key, e.key === 'ArrowLeft' ? -1 : 1);
      if (move) { handled(); refocusKey.current = col.key; move(); }
      return;
    }
    if (menu && ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu')) {
      handled();
      const r = e.currentTarget.getBoundingClientRect();
      setMenuAt({ x: r.left, y: r.bottom, key: col.key });
    }
  };

  const onGripKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, index: number) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? KEY_STEP_BIG_PX : KEY_STEP_PX;
      onResizeBy?.(index, e.key === 'ArrowLeft' ? -step : step);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      onAutofit(index);
    }
  };

  // Runs before anything inside the header cell (a sort button, say): the click
  // that ends a column move or a divider press must not reach any of it.
  const onCellClickCapture = (e: React.MouseEvent) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  const onCellClick = (col: ColDef, sortable: boolean) => {
    if (sortable) onSort?.(col.key);
  };

  return (
    <div
      className="tracklist-header tl-header"
      style={gridStyle}
      role="row"
      aria-rowindex={ariaRowIndex}
      ref={rowRef}
      onContextMenu={onHeaderContextMenu}
    >
      {cols.map((col, index) => {
        const align = columnAlign(col);
        const sortable = Boolean(onSort) && (isSortable?.(col.key) ?? false);
        const active = sort && sort.key === col.key ? sort : null;
        const isDragged = drag?.key === col.key;
        const focusable = sortable || Boolean(menu) || (Boolean(onReorder) && col.key !== 'num');
        const drop = drag?.target?.key === col.key ? drag.target.side : null;
        return (
          <div
            key={col.key}
            role="columnheader"
            aria-sort={ariaSortOf ? ariaSortOf(col.key) : active ? (active.dir === 'asc' ? 'ascending' : 'descending') : undefined}
            data-tl-col={col.key}
            className={
              `tl-head-cell tl-cell--${align}`
              + (sortable ? ' tl-head-cell--sortable' : '')
              + (active ? ' tracklist-header-cell-active' : '')
              + (isDragged ? ' tl-head-cell--dragging' : '')
              + (drop ? ` tl-head-cell--drop-${drop}` : '')
              + (headCellClassName ? ` ${headCellClassName(col)}` : '')
            }
            tabIndex={focusable ? 0 : undefined}
            onPointerDown={e => onCellPointerDown(e, col)}
            onClickCapture={onCellClickCapture}
            // Mouse users get no focus here: a focused header would take the
            // next Space or Enter (play/pause, play row) and sort again.
            onMouseDown={e => e.preventDefault()}
            onClick={() => onCellClick(col, sortable)}
            onKeyDown={e => onCellKeyDown(e, col, sortable)}
          >
            <span className="tl-head-label">{renderLabel(col)}</span>
            {active && (
              <span className="tl-sort-indicator" aria-hidden="true">{active.dir === 'asc' ? '▲' : '▼'}</span>
            )}
            {resizable && (
              <div
                className="tl-grip col-resize-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label={columnName(col, t)}
                aria-valuenow={widthOf(col.key)}
                aria-valuemin={col.minWidth}
                tabIndex={0}
                onKeyDown={e => onGripKeyDown(e, index)}
                onPointerDown={e => onGripPointerDown(e, index)}
                onClick={e => e.stopPropagation()}
              />
            )}
          </div>
        );
      })}
      {menu && menuAt && (
        <TracklistHeaderMenu
          {...menu}
          x={menuAt.x}
          y={menuAt.y}
          onMoveLeft={neighbourMove(menuAt.key, -1)}
          onMoveRight={neighbourMove(menuAt.key, 1)}
          onClose={closeMenu}
          t={t}
        />
      )}
      {drag && createPortal(
        <div className="tl-drag-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          {(() => {
            const dragged = cols.find(c => c.key === drag.key);
            const label = dragged ? renderLabel(dragged) : null;
            // A column that shows no label (row buttons) is shown by its name.
            return label === null || label === undefined || label === '' ? drag.label : label;
          })()}
        </div>,
        document.body,
      )}
    </div>
  );
}
