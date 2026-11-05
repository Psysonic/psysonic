import React from 'react';
import type { TFunction } from 'i18next';
import type { ColDef } from '@/lib/hooks/useTracklistColumns';
import { isSortable, type SortKey } from '@/features/album/utils/albumTrackListHelpers';
import { TracklistHeader } from '@/ui/tracklist/TracklistHeader';
import type { TracklistMenuConfig } from '@/ui/tracklist/TracklistHeaderMenu';

interface Props {
  visibleCols: readonly ColDef[];
  gridStyle: React.CSSProperties;
  sortKey?: SortKey;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: SortKey) => void;
  allSelected: boolean;
  inSelectMode: boolean;
  toggleAll: () => void;
  startResize: (e: React.PointerEvent, colIndex: number) => void;
  onAutofit: (colIndex: number) => void;
  onResizeBy: (colIndex: number, deltaPx: number) => void;
  widthOf: (key: string) => number;
  onReorder: (key: string, targetKey: string, side: 'before' | 'after') => void;
  menu: TracklistMenuConfig;
  t: TFunction;
}

/**
 * Header row of the album track list: the shared track-table header, with the
 * bulk-selection toggle in the `#` cell so shift-click ranges anchor against it.
 */
export function TracklistHeaderRow({
  visibleCols,
  gridStyle,
  sortKey,
  sortDir,
  onSort,
  allSelected,
  inSelectMode,
  toggleAll,
  startResize,
  onAutofit,
  onResizeBy,
  widthOf,
  onReorder,
  menu,
  t,
}: Props) {
  const renderLabel = (col: ColDef) => {
    if (col.key === 'num') {
      return (
        <span className="track-num">
          <span
            className={`bulk-check${allSelected ? ' checked' : ''}${inSelectMode ? ' bulk-check-visible' : ''}`}
            onClick={e => { e.stopPropagation(); toggleAll(); }}
            style={{ cursor: 'pointer' }}
          />
          <span className="track-num-number">#</span>
        </span>
      );
    }
    return col.i18nKey ? t(`albumDetail.${col.i18nKey}`) : '';
  };

  return (
    <TracklistHeader
      cols={visibleCols}
      gridStyle={gridStyle}
      renderLabel={renderLabel}
      sort={sortKey && sortDir && sortKey !== 'natural' ? { key: sortKey, dir: sortDir } : null}
      isSortable={isSortable}
      onSort={onSort ? key => onSort(key as SortKey) : undefined}
      onResizeStart={startResize}
      onAutofit={onAutofit}
      onResizeBy={onResizeBy}
      widthOf={widthOf}
      onReorder={onReorder}
      menu={menu}
      t={t}
    />
  );
}
