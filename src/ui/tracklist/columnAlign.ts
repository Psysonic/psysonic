import type { ColDef, ColumnAlign } from '@/lib/hooks/useTracklistColumns';

/** The columns that carry names: left-aligned like any running text. */
const NAME_COLUMNS = new Set(['title', 'artist', 'album']);

/**
 * Alignment of a column's header label and cells. Names read from the left and
 * the track number sits at the right; every other column is centred, so two
 * neighbours never stick together at their shared divider however wide they
 * are dragged. A column can still state its own alignment.
 */
export function columnAlign(col: Pick<ColDef, 'key' | 'align'>): ColumnAlign {
  if (col.align) return col.align;
  if (NAME_COLUMNS.has(col.key)) return 'start';
  if (col.key === 'num') return 'end';
  return 'center';
}
