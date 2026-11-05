import { useCallback, type MouseEvent, type ReactNode } from 'react';
import type { ColDef } from '@/lib/hooks/useTracklistColumns';
import { useThemeStore } from '@/store/themeStore';
import { columnAlign } from '@/ui/tracklist/columnAlign';
import { clipsContent } from '@/ui/tracklist/cellTooltip';

interface Props {
  col: ColDef;
  /** Extra classes (table-specific styling hooks). */
  className?: string;
  /** ARIA role of the cell, for tables that expose `role="table"`. */
  role?: string;
  /** Plain text the cell shows (title, artist, album, genre): measured by autofit, shown as tooltip when cut off. */
  text?: string;
  children: ReactNode;
}

/**
 * One cell of a track-table row. Gives every cell the same padding and the
 * column's alignment, so it lines up with its header label, and marks it with
 * `data-tl-col` so a double-click on the divider can measure the column.
 *
 * Text cells also carry their text: hovering one whose text is cut off shows
 * the full text (same switch as the cards' "full name on hover").
 */
export function TracklistCell({ col, text, className, role, children }: Props) {
  const tooltipsOn = useThemeStore(s => s.showCardTooltips);
  const withTooltip = Boolean(text) && tooltipsOn;

  // The tooltip portal finds anchors by a delegated mouseover, so the attribute
  // is set up front and only corrected on enter (see useOverflowTooltip).
  const onMouseEnter = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const cell = e.currentTarget;
    if (text && clipsContent(cell)) cell.setAttribute('data-tooltip', text);
    else cell.removeAttribute('data-tooltip');
  }, [text]);

  return (
    <div
      className={`tl-cell tl-cell--${columnAlign(col)}${className ? ` ${className}` : ''}`}
      role={role}
      data-tl-col={col.key}
      data-tl-text={text || undefined}
      data-tooltip={withTooltip ? text : undefined}
      data-tooltip-wrap={withTooltip ? '' : undefined}
      onMouseEnter={withTooltip ? onMouseEnter : undefined}
    >
      {children}
    </div>
  );
}
