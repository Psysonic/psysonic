/**
 * Move the source at `from` so it lands at exactly index `to` — the ↑/↓ buttons,
 * i.e. a swap with the neighbour. Returns a new array, or `null` for an
 * out-of-range or no-op move (so the caller can skip a redundant update).
 */
export function moveSourceTo<T extends { source: string }>(
  sources: T[],
  from: number,
  to: number,
): T[] | null {
  if (from === to || from < 0 || to < 0 || from >= sources.length || to >= sources.length) return null;
  const next = sources.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Insert the source at `from` immediately before the row at `beforeIndex` — the
 * drag-drop case, matching the "line above this row" drop indicator. The -1 when
 * dragging downward accounts for the slot the dragged item vacated. Returns a
 * new array, or `null` for an out-of-range or no-op move.
 */
export function dropSourceBefore<T extends { source: string }>(
  sources: T[],
  from: number,
  beforeIndex: number,
): T[] | null {
  if (from === beforeIndex || from < 0 || from >= sources.length) return null;
  const next = sources.slice();
  const [item] = next.splice(from, 1);
  next.splice(from < beforeIndex ? beforeIndex - 1 : beforeIndex, 0, item);
  return next;
}

/**
 * Write an edit of a filtered view back into the full list: the rows of `visible`
 * take the slots the visible rows held in `full`, in their new order and with
 * their new switches; hidden rows keep their place and their switch.
 */
export function mergeVisibleSources<T extends { source: string }>(full: T[], visible: T[]): T[] {
  const shown = new Set(visible.map((s) => s.source));
  let next = 0;
  return full.map((s) => (shown.has(s.source) ? visible[next++] : s));
}
