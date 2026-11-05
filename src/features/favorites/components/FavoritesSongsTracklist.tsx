import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import FavoriteSongRow, { type FavoriteSongRowCallbacks } from '@/features/favorites/components/FavoriteSongRow';
import { TracklistColumnPicker } from '@/ui/TracklistColumnPicker';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { fittedWidth, type ColDef } from '@/lib/hooks/useTracklistColumns';
import { TracklistHeader } from '@/ui/tracklist/TracklistHeader';
import { TracklistViewport, TRACKLIST_STICKY_HEADER_PX } from '@/ui/tracklist/TracklistViewport';
import { measureColumnContent, songColumnTexts } from '@/ui/tracklist/measureColumnContent';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { previewInputFromSong, usePreviewStore } from '@/features/playback/store/previewStore';
import { useSelectionStore } from '@/store/selectionStore';
import { useThemeStore } from '@/store/themeStore';
import { useDragDrop } from '@/lib/dnd/DragDropContext';
import { useDragPressHandle } from '@/lib/dnd/useDragPress';
import { useOrbitSongRowBehavior } from '@/features/orbit';
import { songToTrack } from '@/lib/media/songToTrack';
import { appendServerQuery, buildArtistDetailPath } from '@/lib/navigation/detailServerScope';
import { APP_MAIN_SCROLL_VIEWPORT_ID } from '@/constants/appScroll';
import { useElementClientHeightById } from '@/lib/hooks/useResizeClientHeight';
import { useTrackListCursor } from '@/lib/hooks/useTrackListCursor';
import { SORTABLE_COLUMNS } from '@/features/favorites/hooks/useFavoritesSongFiltering';
import { COVER_ARTIST_TOP_TRACK_CSS_PX } from '@/cover/layoutSizes';
import { useWarmTrackListAlbumCovers } from '@/cover/useWarmTrackListAlbumCovers';
import { useTrackListCoverArtEnabled } from '@/cover/useTrackListCoverArtSettings';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';

interface Props {
  visibleSongs: SubsonicSong[];
  selectedIds: Set<string>;
  selectedCount: number;
  inSelectMode: boolean;
  toggleSelect: (id: string, idx: number, shift: boolean) => void;
  allColumns: readonly ColDef[];
  visibleCols: ColDef[];
  gridStyle: React.CSSProperties;
  colWidths: Record<string, number>;
  contentWidth: number;
  setColumnWidth: (key: string, px: number) => void;
  moveColumn: (key: string, targetKey: string, side: 'before' | 'after') => void;
  colVisible: Set<string>;
  toggleColumn: (key: string) => void;
  resetColumns: () => void;
  pickerOpen: boolean;
  setPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  pickerRef: React.RefObject<HTMLDivElement | null>;
  tracklistRef: React.RefObject<HTMLDivElement | null>;
  startResize: (e: React.PointerEvent, key: string) => void;
  handleSortClick: (key: string) => void;
  sort: { key: string; dir: 'asc' | 'desc' } | null;
  ratings: Record<string, number>;
  handleRate: (song: SubsonicSong, rating: number) => void;
  removeSong: (song: SubsonicSong) => void;
  hasFilters: boolean;
}

export default function FavoritesSongsTracklist({
  visibleSongs, selectedIds, selectedCount, inSelectMode, toggleSelect,
  allColumns, visibleCols, gridStyle, colWidths, contentWidth, setColumnWidth, moveColumn,
  colVisible, toggleColumn, resetColumns,
  pickerOpen, setPickerOpen, pickerRef, tracklistRef,
  startResize, handleSortClick, sort,
  ratings, handleRate, removeSong, hasFilters,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const playTrack = usePlayerStore(s => s.playTrack);
  const openContextMenu = usePlayerStore(s => s.openContextMenu);
  const userRatingOverrides = usePlayerStore(s => s.userRatingOverrides);
  const previewingId = usePreviewStore(s => s.previewingId);
  const previewingTrack = usePreviewStore(s => s.previewingTrack);
  const previewAudioStarted = usePreviewStore(s => s.audioStarted);
  const showBitrate = useThemeStore(s => s.showBitrate);
  const trackListCoversOn = useTrackListCoverArtEnabled('pages');
  const psyDrag = useDragDrop();
  // Rows are virtualised, so one can be recycled out from under a held button.
  const dragPress = useDragPressHandle();
  const { orbitActive, doubleClickToPlay, queueHint, addTrackToOrbit } = useOrbitSongRowBehavior();

  const visibleTracks = useMemo(() => visibleSongs.map(songToTrack), [visibleSongs]);

  const cursorKeys = useMemo(() => visibleSongs.map(ownedEntityKey), [visibleSongs]);
  const cursor = useTrackListCursor({
    keys: cursorKeys,
    onActivate: index => {
      const song = visibleSongs[index];
      if (!song) return;
      if (orbitActive) addTrackToOrbit(song.id, song.serverId);
      else playTrack(visibleTracks[index], visibleTracks, true, false, index);
    },
    // `rowVirtualizer` is declared further down; this only runs on a key press, after render.
    scrollToIndex: index => rowVirtualizer.scrollToIndex(index, { align: 'auto' }),
  });
  const { setCursorFromClick } = cursor;

  const latestVals = {
    visibleSongs, visibleTracks, selectedIds, inSelectMode, orbitActive, doubleClickToPlay,
    toggleSelect, handleRate, removeSong, playTrack, openContextMenu,
    navigate, queueHint, addTrackToOrbit, psyDrag, setCursorFromClick,
    cursorIndex: cursor.cursorIndex,
  };
  const latest = useRef(latestVals);
  latest.current = latestVals;

  const cb = useMemo<FavoriteSongRowCallbacks>(() => ({
    activate: (song, index, e) => {
      if ((e.target as HTMLElement).closest('button, a, input')) return;
      const L = latest.current;
      const key = ownedEntityKey(song);
      if (e.ctrlKey || e.metaKey) {
        // A Ctrl click that starts a multi-selection takes the highlighted row along.
        const at = L.cursorIndex;
        if (!L.inSelectMode && at !== null && at !== index) {
          L.toggleSelect(ownedEntityKey(L.visibleSongs[at]), at, false);
        }
        L.toggleSelect(key, index, false);
        return;
      }
      if (L.inSelectMode) { L.toggleSelect(key, index, e.shiftKey); return; }
      L.setCursorFromClick(index, e);
      if (L.orbitActive) L.queueHint();
      else if (!L.doubleClickToPlay) L.playTrack(L.visibleTracks[index], L.visibleTracks, true, false, index);
    },
    doubleClick: (song, index, e) => {
      if ((e.target as HTMLElement).closest('button, a, input')) return;
      const L = latest.current;
      if (e.ctrlKey || e.metaKey || L.inSelectMode) return;
      if (L.orbitActive) L.addTrackToOrbit(song.id, song.serverId);
      else L.playTrack(L.visibleTracks[index], L.visibleTracks, true, false, index);
    },
    context: (song, e) => {
      e.preventDefault();
      const L = latest.current;
      // A right-click inside a multi-row selection addresses the whole
      // selection (same as the album/artist grids); one row keeps its own menu.
      const { selectedIds: selIds } = useSelectionStore.getState();
      if (selIds.size > 1) {
        const selected = L.visibleSongs.filter(s => selIds.has(ownedEntityKey(s)));
        if (selected.length > 1) {
          L.openContextMenu(e.clientX, e.clientY, selected.map(songToTrack), 'multi-song');
          return;
        }
      }
      L.openContextMenu(e.clientX, e.clientY, songToTrack(song), 'favorite-song');
    },
    mouseDownRow: (song, e) => {
      dragPress.arm(e, {
        canStart: (ev) => !(ev.target as HTMLElement).closest('button, a, input'),
        onStart: (me) => {
          const L = latest.current;
          const { selectedIds: selIds } = useSelectionStore.getState();
          if (selIds.has(ownedEntityKey(song)) && selIds.size > 1) {
            const bulkTracks = L.visibleSongs.filter(s => selIds.has(ownedEntityKey(s))).map(songToTrack);
            L.psyDrag.startDrag({ data: JSON.stringify({ type: 'songs', tracks: bulkTracks }), label: `${bulkTracks.length} Songs` }, me.clientX, me.clientY);
          } else {
            L.psyDrag.startDrag({ data: JSON.stringify({ type: 'song', track: songToTrack(song) }), label: song.title }, me.clientX, me.clientY);
          }
        },
      });
    },
    toggleSelect: (songId, index, shift) => latest.current.toggleSelect(songId, index, shift),
    play: (index) => {
      const L = latest.current;
      if (L.orbitActive) { L.queueHint(); return; }
       L.playTrack(L.visibleTracks[index], L.visibleTracks, true, false, index);
    },
    startPreview: (song) => usePreviewStore.getState().startPreview(
      previewInputFromSong(song),
      'favorites',
    ),
    rate: (song, r) => latest.current.handleRate(song, r),
    remove: (song) => latest.current.removeSong(song),
    navArtist: (artistId, serverId) => {
      latest.current.navigate(buildArtistDetailPath(artistId, { serverId }));
    },
    navAlbum: (albumId, serverId) => {
      const query = appendServerQuery(undefined, serverId);
      latest.current.navigate(query ? `/album/${albumId}?${query}` : `/album/${albumId}`);
    },
  }), [dragPress]);

  const listWrapRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const viewportH = useElementClientHeightById(APP_MAIN_SCROLL_VIEWPORT_ID);

  // Bulk bar show/hide shifts listWrapRef top — remeasure on that edge only.
  const bulkBarVisible = selectedIds.size > 0;

  useLayoutEffect(() => {
    const sc = document.getElementById(APP_MAIN_SCROLL_VIEWPORT_ID);
    // scrollMargin must track height changes in sections above the list (filters, top artists).
    // Intentionally coupled to the Favorites page shell class — keep in sync with that layout.
    const root = tracklistRef.current?.closest('.content-body') as HTMLElement | null;
    if (!sc) return;
    const measure = () => {
      const wrap = listWrapRef.current;
      if (!wrap) return;
      const m = wrap.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
      setScrollMargin(prev => (Math.abs(prev - m) > 0.5 ? m : prev));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(sc);
    if (root) ro.observe(root);
    measure();
    return () => ro.disconnect();
  }, [tracklistRef, bulkBarVisible, pickerOpen, visibleSongs.length]);

  // React Compiler incompatible-library rule: third-party hook/value the compiler cannot analyze; usage is correct.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: visibleSongs.length,
    getScrollElement: () => document.getElementById(APP_MAIN_SCROLL_VIEWPORT_ID),
    estimateSize: () => 48,
    overscan: Math.max(8, Math.ceil(viewportH / 48)),
    scrollMargin,
    // Keep a row reached with the arrow keys clear of the sticky header.
    scrollPaddingStart: TRACKLIST_STICKY_HEADER_PX,
    getItemKey: i => ownedEntityKey(visibleSongs[i]),
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  const warmVisibleSongs = useMemo(
    () => virtualItems.map(vi => visibleSongs[vi.index]),
    [virtualItems, visibleSongs],
  );

  useWarmTrackListAlbumCovers(warmVisibleSongs, COVER_ARTIST_TOP_TRACK_CSS_PX, {
    enabled: trackListCoversOn,
  });

  const allSelected = selectedCount === visibleSongs.length && visibleSongs.length > 0;
  const handleAutofit = (colIndex: number) => {
    const col = visibleCols[colIndex];
    const root = tracklistRef.current;
    if (!col || !root) return;
    const content = measureColumnContent(root, col.key, songColumnTexts(visibleSongs, col.key));
    setColumnWidth(col.key, fittedWidth(content, col.minWidth));
  };

  const header = (
    <TracklistHeader
      cols={visibleCols}
      gridStyle={gridStyle}
      renderLabel={col => {
        if (col.key === 'num') {
          return (
            <span className="track-num">
              <span
                className={`bulk-check${allSelected ? ' checked' : ''}${inSelectMode ? ' bulk-check-visible' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={e => {
                  e.stopPropagation();
                  if (allSelected) {
                    useSelectionStore.getState().clearAll();
                  } else {
                    useSelectionStore.getState().setSelectedIds(() => new Set(visibleSongs.map(ownedEntityKey)));
                  }
                }}
              />
              <span className="track-num-number">#</span>
            </span>
          );
        }
        return col.i18nKey ? t(`albumDetail.${col.i18nKey}`) : '';
      }}
      sort={sort}
      isSortable={key => SORTABLE_COLUMNS.has(key)}
      onSort={handleSortClick}
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
        allColumns,
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
    <>
      <TracklistColumnPicker
        allColumns={allColumns}
        pickerRef={pickerRef}
        pickerOpen={pickerOpen}
        setPickerOpen={setPickerOpen}
        colVisible={colVisible}
        toggleColumn={toggleColumn}
        resetColumns={resetColumns}
        t={t}
      />
    <div className="tracklist tracklist--model-a" data-preview-loc="favorites" style={{ padding: 0 }} ref={tracklistRef} {...cursor.listProps} onClick={e => {
      if (inSelectMode && e.target === e.currentTarget) useSelectionStore.getState().clearAll();
    }}>

      <TracklistViewport contentWidth={contentWidth} header={header}>
      <div ref={listWrapRef} style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
        {virtualItems.map(vi => {
          const song = visibleSongs[vi.index];
          const i = vi.index;
          return (
            <div
              key={vi.key}
              data-index={i}
              ref={rowVirtualizer.measureElement}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start - scrollMargin}px)` }}
            >
              <FavoriteSongRow
                song={song}
                index={i}
                visibleCols={visibleCols}
                gridStyle={gridStyle}
                showBitrate={showBitrate}
                isActive={currentTrack ? ownedEntityKey(currentTrack) === ownedEntityKey(song) : false}
                showEq={currentTrack ? ownedEntityKey(currentTrack) === ownedEntityKey(song) && isPlaying : false}
                isSelected={selectedIds.has(ownedEntityKey(song))}
                inSelectMode={inSelectMode}
                ratingValue={ratings[ownedEntityKey(song)] ?? userRatingOverrides[ownedEntityKey(song)] ?? userRatingOverrides[song.id] ?? song.userRating ?? 0}
                isPreviewing={previewingId === song.id && previewingTrack?.serverId === song.serverId}
                previewStarted={previewingId === song.id && previewingTrack?.serverId === song.serverId && previewAudioStarted}
                doubleClickActive={orbitActive || doubleClickToPlay}
                cursorRowId={cursor.cursorIndex === i ? cursor.cursorRowId : undefined}
                cb={cb}
              />
            </div>
          );
        })}
      </div>
      </TracklistViewport>

      {/* Empty state when filters return no results */}
      {visibleSongs.length === 0 && hasFilters && (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
          {t('favorites.noFilterResults')}
        </div>
      )}
    </div>
    </>
  );
}
