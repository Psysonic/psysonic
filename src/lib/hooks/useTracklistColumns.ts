import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';

export type ColumnAlign = 'start' | 'center' | 'end';

export interface ColDef {
  readonly key: string;
  readonly i18nKey?: string | null;
  /**
   * Full translation key of the column's name when its header shows no label
   * (a column of row buttons): read out on its divider and shown while it is moved.
   */
  readonly nameKey?: string;
  readonly minWidth: number;
  readonly defaultWidth: number;
  readonly required: boolean;
  /** Horizontal alignment of the cell content and of the header label. Absent = `start`. */
  readonly align?: ColumnAlign;
  /**
   * Offered in the picker but off until someone turns it on. For lists that can
   * define more columns than fit at once, so the default view stays inside the
   * page instead of running past its right edge.
   */
  readonly defaultHidden?: boolean;
}

/** Shared title column — room for play/preview/cover controls + readable title text. */
export const TRACK_TITLE_COL = {
  minWidth: 240,
  defaultWidth: 340,
} as const;

/** Widest a double-click on a divider may make a column, so one huge title cannot blow the table up. */
export const AUTOFIT_MAX_PX = 560;

/**
 * Stored-prefs format. Version 2 is the "every column has a real width" model.
 * Before it, the title column was `minmax(<stored>, 1fr)`: the stored value was
 * a minimum, not the width the user saw, so it is dropped on the first load.
 */
const PREFS_VERSION = 2;

/** Width after dragging a divider by `deltaPx`: only that column changes, never below its minimum. */
export function resizedWidth(startWidth: number, deltaPx: number, minWidth: number): number {
  return Math.max(minWidth, Math.round(startWidth + deltaPx));
}

/** Width for a double-click autofit: the content width, rounded up, between the minimum and the cap. */
export function fittedWidth(contentPx: number, minWidth: number): number {
  return Math.min(AUTOFIT_MAX_PX, Math.max(minWidth, Math.ceil(contentPx)));
}

function columnWidth(c: ColDef, widths: Record<string, number>): number {
  const w = widths[c.key];
  return typeof w === 'number' && w >= c.minWidth ? w : c.defaultWidth;
}

/**
 * Grid and total width for a list of columns. For tables that show a subset of
 * the hook's visible columns (offline album lists drop `favorite`, the genre mix
 * drops `genre`); a column without a stored width gets its default.
 */
export function gridFor(
  cols: readonly ColDef[],
  widths: Record<string, number>,
): { gridStyle: React.CSSProperties; contentWidth: number } {
  const px = cols.map(c => columnWidth(c, widths));
  return {
    gridStyle: { gridTemplateColumns: px.map(w => `${w}px`).join(' ') },
    contentWidth: px.reduce((sum, w) => sum + w, 0),
  };
}

/** The number column (selection box + track number) always stays first. */
const PINNED_FIRST = 'num';

function pinFirst(order: string[]): string[] {
  const at = order.indexOf(PINNED_FIRST);
  if (at <= 0) return order;
  return [PINNED_FIRST, ...order.slice(0, at), ...order.slice(at + 1)];
}

/**
 * Stored column order, cleaned up for the current column list: unknown keys go,
 * and a column the list gained since the order was saved slots in right after
 * the column that precedes it in the list's own definition.
 */
function resolveOrder(stored: readonly string[] | undefined, columns: readonly ColDef[]): string[] {
  const defined = columns.map(c => c.key);
  if (!stored || stored.length === 0) return pinFirst(defined);
  const order = stored.filter((key, i) => defined.includes(key) && stored.indexOf(key) === i);
  defined.forEach((key, defIndex) => {
    if (order.includes(key)) return;
    let insertAt = 0;
    for (let k = defIndex - 1; k >= 0; k--) {
      const at = order.indexOf(defined[k]);
      if (at >= 0) { insertAt = at + 1; break; }
    }
    order.splice(insertAt, 0, key);
  });
  return pinFirst(order);
}

/** Order after dropping `key` before or after `targetKey`. The number column never moves. */
export function movedOrder(
  order: readonly string[],
  key: string,
  targetKey: string,
  side: 'before' | 'after',
): string[] {
  if (key === PINNED_FIRST || key === targetKey || !order.includes(key) || !order.includes(targetKey)) {
    return [...order];
  }
  const rest = order.filter(k => k !== key);
  const targetAt = rest.indexOf(targetKey);
  const insertAt = targetKey === PINNED_FIRST ? targetAt + 1 : targetAt + (side === 'after' ? 1 : 0);
  rest.splice(insertAt, 0, key);
  return rest;
}

function loadPrefs(
  storageKey: string,
  columns: readonly ColDef[],
): { widths: Record<string, number>; visible: Set<string>; order: string[] } {
  const defaultWidths: Record<string, number> = Object.fromEntries(
    columns.map(c => [c.key, c.defaultWidth]),
  );
  const defaultVisible = new Set<string>(
    columns.filter(c => !c.defaultHidden).map(c => c.key),
  );
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { widths: defaultWidths, visible: defaultVisible, order: resolveOrder(undefined, columns) };
    const parsed = JSON.parse(raw) as {
      v?: number; widths?: Record<string, number>; visible?: string[]; known?: string[]; order?: string[];
    };
    const visible = new Set<string>(parsed.visible ?? [...defaultVisible]);
    columns.filter(c => c.required).forEach(c => visible.add(c.key));
    // Auto-show columns that are new since prefs were last saved.
    // "known" tracks every column seen at save time; absent = newly added column → default to visible.
    if (parsed.known) {
      const known = new Set<string>(parsed.known);
      columns
        .filter(c => !c.required && !c.defaultHidden && !known.has(c.key))
        .forEach(c => visible.add(c.key));
    }
    const stored = { ...(parsed.widths ?? {}) };
    if (parsed.v !== PREFS_VERSION) delete stored.title;
    const widths = { ...defaultWidths, ...stored };
    // Anything below a column's minimum (old flex `0`s, tampered values) falls back to its default.
    columns.forEach(c => { widths[c.key] = columnWidth(c, widths); });
    return { widths, visible, order: resolveOrder(parsed.order, columns) };
  } catch {
    return { widths: defaultWidths, visible: defaultVisible, order: resolveOrder(undefined, columns) };
  }
}

function savePrefs(
  storageKey: string,
  widths: Record<string, number>,
  visible: Set<string>,
  order: readonly string[],
) {
  const known = Object.keys(widths);
  localStorage.setItem(storageKey, JSON.stringify({
    v: PREFS_VERSION, widths, visible: [...visible], known, order,
  }));
}

/**
 * Column engine of the track tables: spreadsheet / file-manager model.
 * Every visible column has a width in px; dragging a divider changes only the
 * column left of it; the table is as wide as the sum of its columns and the
 * surrounding viewport scrolls sideways when that is wider than the view.
 */
export function useTracklistColumns(columns: readonly ColDef[], storageKey: string) {
  const [colWidths, setColWidths] = useState<Record<string, number>>(
    () => loadPrefs(storageKey, columns).widths,
  );
  const [colVisible, setColVisible] = useState<Set<string>>(
    () => loadPrefs(storageKey, columns).visible,
  );
  const [colOrder, setColOrder] = useState<string[]>(
    () => loadPrefs(storageKey, columns).order,
  );
  const [pickerOpen, setPickerOpen] = useState(false);

  const tracklistRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  // Refs to avoid stale closures in drag/save handlers
  const colWidthsRef = useRef(colWidths);
  const colVisibleRef = useRef(colVisible);
  const colOrderRef = useRef(colOrder);
  useEffect(() => { colWidthsRef.current = colWidths; }, [colWidths]);
  useEffect(() => { colVisibleRef.current = colVisible; }, [colVisible]);
  useEffect(() => { colOrderRef.current = colOrder; }, [colOrder]);

  const visibleCols = useMemo(() => {
    const byKey = new Map(columns.map(c => [c.key, c]));
    return resolveOrder(colOrder, columns)
      .map(key => byKey.get(key)!)
      .filter(c => colVisible.has(c.key));
  }, [columns, colVisible, colOrder]);

  const { gridStyle, contentWidth } = useMemo(
    () => gridFor(visibleCols, colWidths),
    [visibleCols, colWidths],
  );

  const setColumnWidth = useCallback((key: string, px: number) => {
    const def = columns.find(c => c.key === key);
    if (!def) return;
    const next = { ...colWidthsRef.current, [key]: Math.max(def.minWidth, Math.round(px)) };
    colWidthsRef.current = next;
    setColWidths(next);
    savePrefs(storageKey, next, colVisibleRef.current, colOrderRef.current);
  }, [columns, storageKey]);

  // Drag a divider: only the column left of it changes, the divider follows the pointer.
  const startResize = useCallback(
    (e: React.PointerEvent, key: string) => {
      e.preventDefault();
      e.stopPropagation();
      const colDef = columns.find(c => c.key === key);
      if (!colDef) return;
      const colKey = colDef.key;
      const startX = e.clientX;
      const startW = columnWidth(colDef, colWidthsRef.current);
      // The ref only catches up after React has rendered a move; a release can
      // arrive before that, so the width to save is kept here.
      let lastW = startW;
      // Keep receiving the pointer even when it leaves the window mid-drag.
      const target = e.currentTarget as Element | null;
      try { target?.setPointerCapture?.(e.pointerId); } catch { /* not capturable */ }

      const onMove = (me: PointerEvent) => {
        // The release got lost (let go outside the window): no button is down any more.
        if (me.buttons === 0) {
          onUp();
          return;
        }
        const newW = resizedWidth(startW, me.clientX - startX, colDef.minWidth);
        lastW = newW;
        setColWidths(prev => (prev[colKey] === newW ? prev : { ...prev, [colKey]: newW }));
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        const widths = { ...colWidthsRef.current, [colKey]: lastW };
        colWidthsRef.current = widths;
        savePrefs(storageKey, widths, colVisibleRef.current, colOrderRef.current);
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [columns, storageKey],
  );

  const moveColumn = useCallback((key: string, targetKey: string, side: 'before' | 'after') => {
    const next = movedOrder(resolveOrder(colOrderRef.current, columns), key, targetKey, side);
    colOrderRef.current = next;
    setColOrder(next);
    savePrefs(storageKey, colWidthsRef.current, colVisibleRef.current, next);
  }, [columns, storageKey]);

  const toggleColumn = useCallback(
    (key: string) => {
      const def = columns.find(c => c.key === key)!;
      if (def.required) return;
      setColVisible(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        savePrefs(storageKey, colWidthsRef.current, next, colOrderRef.current);
        return next;
      });
    },
    [columns, storageKey],
  );

  const resetColumns = useCallback(() => {
    const defaultWidths = Object.fromEntries(columns.map(c => [c.key, c.defaultWidth]));
    // Same rule as the initial load: resetting must not switch on the columns a
    // list ships hidden, or "reset" would overflow a table that never showed
    // them in the first place.
    const defaultVisible = new Set(columns.filter(c => !c.defaultHidden).map(c => c.key));
    setColWidths(defaultWidths);
    setColVisible(defaultVisible);
    setColOrder(resolveOrder(undefined, columns));
    localStorage.removeItem(storageKey);
  }, [columns, storageKey]);

  // Note: outside-click / Escape close is handled inside TracklistColumnPicker,
  // because its menu is portalled out of `pickerRef` and a wrapper-only check
  // would close it on every in-menu click.

  return {
    colWidths,
    colVisible,
    visibleCols,
    gridStyle,
    contentWidth,
    setColumnWidth,
    moveColumn,
    startResize,
    toggleColumn,
    resetColumns,
    pickerOpen,
    setPickerOpen,
    pickerRef,
    tracklistRef,
  };
}
