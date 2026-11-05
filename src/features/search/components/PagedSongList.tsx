import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import InpageScrollSentinel from '@/ui/InpageScrollSentinel';
import { useInpageScrollSentinel } from '@/lib/hooks/useInpageScrollSentinel';
import { useTrackListCursor } from '@/lib/hooks/useTrackListCursor';
import { fittedWidth, gridFor, useTracklistColumns } from '@/lib/hooks/useTracklistColumns';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';
import { useTrackListCoverArtEnabled } from '@/cover/useTrackListCoverArtSettings';
import { useWarmTrackListAlbumCovers } from '@/cover/useWarmTrackListAlbumCovers';
import { COVER_ARTIST_TOP_TRACK_CSS_PX } from '@/cover/layoutSizes';
import { useSongRowPlay } from '@/features/search/hooks/useSongRowPlay';
import { SONG_LIST_COLUMNS, SONG_LIST_STORAGE_KEY } from '@/features/search/utils/songListColumns';
import { TracklistHeader } from '@/ui/tracklist/TracklistHeader';
import { TracklistViewport } from '@/ui/tracklist/TracklistViewport';
import { measureColumnContent, songColumnTexts } from '@/ui/tracklist/measureColumnContent';
import SongRow from '@/features/search/components/SongRow';

interface Props {
  songs: SubsonicSong[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  /** Show a BPM column (Advanced Search when the BPM filter is active). */
  showBpm?: boolean;
}

/**
 * Shared song-list view: sticky column header + plain `SongRow`s in the page
 * flow, with an `IntersectionObserver` sentinel for pagination. Used by the
 * Tracks browse list, Search results, and Advanced Search so the three share
 * one chrome + paging path (no transform-positioned rows, so the sticky header
 * is never painted over — issue #841).
 *
 * Columns follow the track tables' spreadsheet model (widths, autofit, moving,
 * menu); the list loads page by page, so its headers do not sort.
 */
export default function PagedSongList({ songs, hasMore, loadingMore, onLoadMore, showBpm }: Props) {
  const { t } = useTranslation();
  const trackListCoversOn = useTrackListCoverArtEnabled('pages');
  const onLoadMoreRef = useRef(onLoadMore);
  // React Compiler refs rule: ref kept in sync with the latest value for use in effects/handlers/cleanup; not render data.
  // eslint-disable-next-line react-hooks/refs
  onLoadMoreRef.current = onLoadMore;

  const bindSentinel = useInpageScrollSentinel({
    active: hasMore,
    onIntersect: () => onLoadMoreRef.current(),
    rootMargin: '600px',
  });

  useWarmTrackListAlbumCovers(songs, COVER_ARTIST_TOP_TRACK_CSS_PX, {
    enabled: trackListCoversOn && songs.length > 0,
  });

  const {
    visibleCols, colWidths, colVisible, setColumnWidth, startResize, moveColumn,
    toggleColumn, resetColumns, tracklistRef,
  } = useTracklistColumns(SONG_LIST_COLUMNS, SONG_LIST_STORAGE_KEY);
  // BPM only where the page asks for it; the column keeps its width meanwhile.
  const displayCols = useMemo(
    () => (showBpm ? visibleCols : visibleCols.filter(c => c.key !== 'bpm')),
    [showBpm, visibleCols],
  );
  // Stable while the columns stay the same, so the memoised rows do not all repaint
  // on every cursor move or page load.
  const { gridStyle, contentWidth } = useMemo(() => gridFor(displayCols, colWidths), [displayCols, colWidths]);

  const playSong = useSongRowPlay();
  const cursorKeys = useMemo(() => songs.map(ownedEntityKey), [songs]);
  const cursor = useTrackListCursor({
    keys: cursorKeys,
    onActivate: index => {
      const song = songs[index];
      if (song) playSong(song);
    },
  });

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
      renderLabel={col => (col.i18nKey ? t(`albumDetail.${col.i18nKey}`) : '')}
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
        allColumns: showBpm ? SONG_LIST_COLUMNS : SONG_LIST_COLUMNS.filter(c => c.key !== 'bpm'),
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
    <div className="song-list-table" ref={tracklistRef} {...cursor.listProps}>
      <TracklistViewport contentWidth={contentWidth} header={header}>
        {songs.map((song, i) => (
          <SongRow
            key={cursorKeys[i]}
            song={song}
            visibleCols={displayCols}
            gridStyle={gridStyle}
            rowIndex={i}
            cursorRowId={cursor.cursorIndex === i ? cursor.cursorRowId : undefined}
            onCursorClick={cursor.setCursorFromClick}
          />
        ))}
      </TracklistViewport>
      {hasMore && (
        <InpageScrollSentinel
          bindSentinel={bindSentinel}
          loading={loadingMore}
          itemCount={songs.length}
          style={{ padding: '1rem', height: 'auto', margin: 0 }}
        />
      )}
    </div>
  );
}
