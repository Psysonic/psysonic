import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';
import { isYearSort, nextYearSort, type AlbumBrowseSort } from '@/lib/library/albumBrowseSort';
import { VirtualCardGrid } from '@/ui/VirtualCardGrid';
import { albumGridWarmCovers, COVER_TRACK_ROW_CSS_PX } from '@/cover/layoutSizes';
import { ALBUM_TABLE_ROW_HEIGHT_PX } from '@/lib/util/cardGridLayout';
import AlbumTableRow from './AlbumTableRow';
import { fittedWidth, useTracklistColumns } from '@/lib/hooks/useTracklistColumns';
import { TracklistHeader } from '@/ui/tracklist/TracklistHeader';
import { TracklistViewport } from '@/ui/tracklist/TracklistViewport';
import { measureColumnContent } from '@/ui/tracklist/measureColumnContent';
import { albumArtistDisplayName } from '@/features/album/utils/deriveAlbumHeaderArtistRefs';
import { ALBUM_TABLE_COLUMNS, ALBUM_TABLE_STORAGE_KEY } from '@/features/album/utils/albumTableColumns';

/** Header sort keys of the columns that can drive the page sort. */
const SORT_KEY_OF_COLUMN: Record<string, AlbumBrowseSort> = {
  title: 'alphabeticalByName',
  artist: 'alphabeticalByArtist',
  year: 'byYear',
};

/** Sort keys the table's clickable headers drive, when the page has them. */
export interface AlbumTableSortControl {
  value: AlbumBrowseSort;
  onChange: (sort: AlbumBrowseSort) => void;
}

interface AlbumTableProps {
  albums: SubsonicAlbum[];
  itemKey: (album: SubsonicAlbum) => string;
  scrollRootId: string;
  disableVirtualization: boolean;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (album: SubsonicAlbum, opts?: { shiftKey?: boolean }) => void;
  selectedAlbums: SubsonicAlbum[];
  /** Appended to `/album/:id`, e.g. `lossless=1`. */
  linkQuery?: string;
  /**
   * Omit on pages without a sort control (New Releases) — headers then render
   * as static labels rather than promising an order the page cannot deliver.
   */
  sort?: AlbumTableSortControl;
}

function SortableHeader({
  label,
  sortKey,
  sort,
}: {
  label: string;
  sortKey: AlbumBrowseSort;
  sort?: AlbumTableSortControl;
}) {
  if (!sort) return <>{label}</>;
  // Title and artist only sort ascending, so their header just selects that
  // sort. Year sorts both ways: newest first on the first press, then each
  // press flips the direction. Composite sorts (artist → year) mark no header:
  // they are not what a single column means.
  const yearHeader = isYearSort(sortKey);
  const active = yearHeader ? isYearSort(sort.value) : sort.value === sortKey;
  const next = yearHeader ? nextYearSort(sort.value) : sortKey;
  return (
    <button
      type="button"
      className={`album-table__sort-btn${active ? ' album-table__sort-btn--active' : ''}`}
      onClick={() => sort.onChange(next)}
      aria-pressed={active}
    >
      {label}
      {active && yearHeader && (sort.value === 'byYearDesc' ? ' ↓' : ' ↑')}
    </button>
  );
}

/**
 * Metadata table for the album catalogue pages, virtualised through the shared
 * card grid pinned to one item per row. The header sits outside the virtualiser
 * (which positions its rows absolutely) and stays stuck to the top of the
 * page's scroll viewport.
 */
export default function AlbumTable({
  albums,
  itemKey,
  scrollRootId,
  disableVirtualization,
  selectionMode,
  selectedIds,
  onToggleSelect,
  selectedAlbums,
  linkQuery,
  sort,
}: AlbumTableProps) {
  const { t } = useTranslation();

  // Virtual rows only receive their item, so the position each row reports as
  // `aria-rowindex` is looked up here — without it a screen reader would count
  // only the handful of rows currently mounted.
  const rowIndexByKey = useMemo(() => {
    const map = new Map<string, number>();
    albums.forEach((album, i) => map.set(itemKey(album), i + 2));
    return map;
  }, [albums, itemKey]);

  const sortedByTitle = sort?.value === 'alphabeticalByName';
  const sortedByArtist = sort?.value === 'alphabeticalByArtist';
  const yearSortDir = sort?.value === 'byYearDesc'
    ? 'descending'
    : sort?.value === 'byYear' ? 'ascending' : 'none';

  const {
    visibleCols, gridStyle, contentWidth, colWidths, colVisible, setColumnWidth, startResize,
    moveColumn, toggleColumn, resetColumns, tracklistRef,
  } = useTracklistColumns(ALBUM_TABLE_COLUMNS, ALBUM_TABLE_STORAGE_KEY);

  const columnTexts = (key: string): string[] | null => {
    if (key === 'title') return albums.map(a => a.name);
    if (key === 'artist') return albums.map(a => albumArtistDisplayName(a));
    return null;
  };
  const handleAutofit = (colIndex: number) => {
    const col = visibleCols[colIndex];
    const root = tracklistRef.current;
    if (!col || !root) return;
    setColumnWidth(col.key, fittedWidth(measureColumnContent(root, col.key, columnTexts(col.key)), col.minWidth));
  };

  const ariaSortOf = (key: string): 'ascending' | 'descending' | 'none' | undefined => {
    if (!sort || !SORT_KEY_OF_COLUMN[key]) return undefined;
    if (key === 'title') return sortedByTitle ? 'ascending' : 'none';
    if (key === 'artist') return sortedByArtist ? 'ascending' : 'none';
    return yearSortDir;
  };

  const header = (
    <TracklistHeader
      cols={visibleCols}
      gridStyle={gridStyle}
      headCellClassName={col => `album-table__head-cell album-table__head-cell--${col.key}`}
      ariaSortOf={ariaSortOf}
      ariaRowIndex={1}
      renderLabel={col => {
        const label = t(col.i18nKey ?? '');
        if (col.key === 'cover') return <span className="visually-hidden">{label}</span>;
        const sortKey = SORT_KEY_OF_COLUMN[col.key];
        return sortKey ? <SortableHeader label={label} sortKey={sortKey} sort={sort} /> : label;
      }}
      onResizeStart={(e, colIndex) => {
        const col = visibleCols[colIndex];
        if (col) startResize(e, col.key);
      }}
      onAutofit={handleAutofit}
      onResizeBy={(colIndex, deltaPx) => {
        const col = visibleCols[colIndex];
        if (col) setColumnWidth(col.key, (colWidths[col.key] ?? col.defaultWidth) + deltaPx);
      }}
      onReorder={moveColumn}
      menu={{
        allColumns: ALBUM_TABLE_COLUMNS,
        colVisible,
        toggleColumn,
        resetColumns,
        onFitAll: () => visibleCols.forEach((_, i) => handleAutofit(i)),
      }}
      widthOf={key => colWidths[key] ?? 0}
      t={t}
    />
  );

  return (
    <div
      className="album-table"
      ref={tracklistRef}
      role="table"
      aria-label={t('albums.tableLabel')}
      aria-rowcount={albums.length + 1}
      style={{ ['--album-table-row-height' as string]: `${ALBUM_TABLE_ROW_HEIGHT_PX}px` }}
    >
      <TracklistViewport contentWidth={contentWidth} header={header}>
      <VirtualCardGrid
        items={albums}
        itemKey={(a, _i) => itemKey(a)}
        rowVariant="albumTableRow"
        singleColumn
        presentationalWrappers
        gridGap="0"
        wrapClassName="album-table__body"
        disableVirtualization={disableVirtualization}
        layoutSignal={albums.length}
        scrollRootId={scrollRootId}
        warmGridCovers={albumGridWarmCovers(COVER_TRACK_ROW_CSS_PX)}
        renderItem={a => (
          <AlbumTableRow
            album={a}
            visibleCols={visibleCols}
            gridStyle={gridStyle}
            rowIndex={rowIndexByKey.get(itemKey(a)) ?? 2}
            selectionMode={selectionMode}
            selected={selectedIds.has(itemKey(a))}
            onToggleSelect={opts => onToggleSelect(a, opts)}
            selectedAlbums={selectedAlbums}
            linkQuery={linkQuery}
            observeScrollRootId={scrollRootId}
          />
        )}
      />
      </TracklistViewport>
    </div>
  );
}
