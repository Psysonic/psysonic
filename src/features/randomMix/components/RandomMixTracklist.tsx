import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { fittedWidth, gridFor, type ColDef, type useTracklistColumns } from '@/lib/hooks/useTracklistColumns';
import { TracklistHeader } from '@/ui/tracklist/TracklistHeader';
import { TracklistViewport } from '@/ui/tracklist/TracklistViewport';
import { measureColumnContent, songColumnTexts } from '@/ui/tracklist/measureColumnContent';
import { RANDOM_MIX_COLUMNS } from '@/features/randomMix/utils/randomMixColumns';

interface Props {
  columns: ReturnType<typeof useTracklistColumns>;
  /** The columns this table shows: the hook's visible ones, minus `genre` in the genre mix. */
  displayCols: readonly ColDef[];
  /** False for the genre mix: it never shows the genre, so its menu does not offer it. */
  withGenre?: boolean;
  songs: readonly SubsonicSong[];
  /** Row-cursor props of the list (`useTrackListCursor`). */
  listProps: React.HTMLAttributes<HTMLDivElement>;
  /** Rows, laid out on the grid this table computes. */
  children: (gridStyle: React.CSSProperties) => React.ReactNode;
}

/**
 * Frame of a random mix table: header with dividers, column menu and moving,
 * plus the sideways-scrolling viewport the rows render into.
 */
export default function RandomMixTracklist({
  columns, displayCols, withGenre = true, songs, listProps, children,
}: Props) {
  const { t } = useTranslation();
  const {
    colWidths, colVisible, setColumnWidth, startResize, moveColumn, toggleColumn, resetColumns, tracklistRef,
  } = columns;
  const { gridStyle, contentWidth } = gridFor(displayCols, colWidths);

  const handleAutofit = (colIndex: number) => {
    const col = displayCols[colIndex];
    const root = tracklistRef.current;
    if (!col || !root) return;
    const content = measureColumnContent(root, col.key, songColumnTexts(songs, col.key));
    setColumnWidth(col.key, fittedWidth(content, col.minWidth));
  };

  const header = (
    <TracklistHeader
      cols={displayCols}
      gridStyle={gridStyle}
      renderLabel={col => {
        if (col.key === 'num') return '';
        const label = col.i18nKey ? t(`albumDetail.${col.i18nKey}`) : '';
        if (col.key !== 'genre') return label;
        return (
          <span data-tooltip={t('randomMix.genreClickHint')} data-tooltip-wrap style={{ cursor: 'help' }}>
            {label} <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 13 }}>ⓘ</span>
          </span>
        );
      }}
      onResizeStart={(e, colIndex) => {
        const col = displayCols[colIndex];
        if (col) startResize(e, col.key);
      }}
      onAutofit={handleAutofit}
      onResizeBy={(colIndex, deltaPx) => {
        const col = displayCols[colIndex];
        if (col) setColumnWidth(col.key, (colWidths[col.key] ?? col.defaultWidth) + deltaPx);
      }}
      onReorder={moveColumn}
      menu={{
        allColumns: withGenre ? RANDOM_MIX_COLUMNS : RANDOM_MIX_COLUMNS.filter(c => c.key !== 'genre'),
        colVisible,
        toggleColumn,
        resetColumns,
        onFitAll: () => displayCols.forEach((_, i) => handleAutofit(i)),
      }}
      widthOf={key => colWidths[key] ?? 0}
      t={t}
    />
  );

  return (
    <div className="tracklist tracklist--model-a" data-preview-loc="randomMix" ref={tracklistRef} {...listProps}>
      <TracklistViewport contentWidth={contentWidth} header={header}>
        {children(gridStyle)}
      </TracklistViewport>
    </div>
  );
}
