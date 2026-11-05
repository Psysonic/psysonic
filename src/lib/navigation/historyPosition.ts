/**
 * Where the app stands in its own navigation history, for the header's back /
 * forward buttons.
 *
 * React Router's browser history stamps every entry it writes with an `idx`
 * in `window.history.state` (0 for the first entry, +1 per push). That says
 * whether there is anything to go back to. The DOM gives no way to ask how
 * many entries lie ahead, so the furthest index is tracked here: a push cuts
 * off everything after it, a back / forward step (POP) keeps it.
 */

export type HistoryNavigationType = 'PUSH' | 'REPLACE' | 'POP';

export type HistoryPosition = {
  /** Index of the current entry. */
  index: number;
  /** Highest index still reachable with forward steps. */
  furthest: number;
};

export const INITIAL_HISTORY_POSITION: HistoryPosition = { index: 0, furthest: 0 };

/** Reads React Router's entry index from a `history.state` value. */
export function readHistoryIndex(state: unknown): number {
  const idx = (state as { idx?: unknown } | null | undefined)?.idx;
  return typeof idx === 'number' && Number.isFinite(idx) && idx >= 0 ? idx : 0;
}

export function nextHistoryPosition(
  previous: HistoryPosition,
  type: HistoryNavigationType,
  index: number,
): HistoryPosition {
  if (type === 'PUSH') return { index, furthest: index };
  return { index, furthest: Math.max(previous.furthest, index) };
}

export function canGoBack(position: HistoryPosition): boolean {
  return position.index > 0;
}

export function canGoForward(position: HistoryPosition): boolean {
  return position.index < position.furthest;
}
