import React, { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { fittedWidth, type useTracklistColumns } from '@/lib/hooks/useTracklistColumns';
import { TracklistHeader } from '@/ui/tracklist/TracklistHeader';
import { TracklistViewport, TRACKLIST_STICKY_HEADER_PX } from '@/ui/tracklist/TracklistViewport';
import { measureColumnContent, songColumnTexts } from '@/ui/tracklist/measureColumnContent';
import {
  previewInputFromSong,
  sameQueueTrack,
  usePlayerStore,
  usePreviewStore,
} from '@/features/playback';
import { useThemeStore } from '@/store/themeStore';
import { useDragDrop } from '@/lib/dnd/DragDropContext';
import { useDragPressHandle } from '@/lib/dnd/useDragPress';
import { useOrbitSongRowBehavior } from '@/features/orbit';
import { songToTrack } from '@/lib/media/songToTrack';

import { appendServerQuery, buildArtistDetailPath } from '@/lib/navigation/detailServerScope';
import { APP_MAIN_SCROLL_VIEWPORT_ID } from '@/constants/appScroll';
import { useElementClientHeightById } from '@/lib/hooks/useResizeClientHeight';
import { useVirtualizerScrollMargin } from '@/lib/hooks/useVirtualizerScrollMargin';
import { useTrackListCursor } from '@/lib/hooks/useTrackListCursor';
import { COVER_ARTIST_TOP_TRACK_CSS_PX } from '@/cover/layoutSizes';
import { useWarmTrackListAlbumCovers } from '@/cover/useWarmTrackListAlbumCovers';
import { useTrackListCoverArtEnabled } from '@/cover/useTrackListCoverArtSettings';
import { useResolvedTracklistBpm } from '@/lib/hooks/useResolvedTracklistBpm';
import ArtistAllTracksRow, { type ArtistAllTracksRowCallbacks } from '@/features/artist/components/ArtistAllTracksRow';
import {
  ARTIST_ALL_TRACKS_COLUMNS,
  ARTIST_ALL_TRACKS_SORTABLE,
  type ArtistAllTracksSortKey,
} from '@/features/artist/utils/artistAllTracksColumns';
import {
  nextArtistAllTracksSort,
  sortArtistAllTracks,
  type ArtistAllTracksSortState,
} from '@/features/artist/utils/artistAllTracksSort';

const ROW_HEIGHT = 48;

interface Props {
  songs: SubsonicSong[];
  loading: boolean;
  /** The index could not answer — shown as an empty state, not an endless spinner. */
  failed: boolean;
  /** Plays the clicked track and hands the rest of the visible order to the queue. */
  onPlay: (songs: SubsonicSong[], index: number) => void;
  /**
   * Column state, owned by the section so its picker can sit in the tab row
   * rather than floating above the table on a line of its own.
   */
  columns: ReturnType<typeof useTracklistColumns>;
}

/**
 * The artist's complete track list: every track they perform on, across their own
 * releases and the compilations and guest spots they appear on.
 *
 * Virtualised because this list is unbounded — a prolific artist can reach into the
 * thousands, where the album tracklist tops out at one record.
 */
export default function ArtistAllTracksList({ songs, loading, failed, onPlay, columns }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const openContextMenu = usePlayerStore(s => s.openContextMenu);
  const previewingId = usePreviewStore(s => s.previewingId);
  const previewAudioStarted = usePreviewStore(s => s.audioStarted);
  const showBitrate = useThemeStore(s => s.showBitrate);
  const trackListCoversOn = useTrackListCoverArtEnabled('pages');
  const psyDrag = useDragDrop();
  // Rows are virtualised, so one can be recycled out from under a held button.
  const dragPress = useDragPressHandle();
  const { orbitActive, doubleClickToPlay, queueHint, addTrackToOrbit } = useOrbitSongRowBehavior();

  const [sort, setSort] = useState<ArtistAllTracksSortState>({ key: 'natural', dir: 'asc' });

  const {
    colVisible, visibleCols, gridStyle, pickerOpen, startResize, tracklistRef,
    colWidths, contentWidth, setColumnWidth, moveColumn, toggleColumn, resetColumns,
  } = columns;
  const resolvedBpmSongs = useResolvedTracklistBpm(
    songs,
    colVisible.has('bpm') || sort.key === 'bpm',
  );
  const displayed = useMemo(
    () => sortArtistAllTracks(resolvedBpmSongs, sort),
    [resolvedBpmSongs, sort],
  );

  // ── Virtualisation against the page's own scroll container ──────────────────
  const listWrapRef = useRef<HTMLDivElement | null>(null);
  const viewportH = useElementClientHeightById(APP_MAIN_SCROLL_VIEWPORT_ID);

  // The shared hook also watches the scroll element's first child, so sections
  // that resolve above this list (bio, similar artists, "also featured on") move
  // the offset with them instead of leaving rows at a stale Y.
  const scrollMargin = useVirtualizerScrollMargin(
    listWrapRef,
    () => document.getElementById(APP_MAIN_SCROLL_VIEWPORT_ID),
    { active: true, deps: [pickerOpen, displayed.length] },
  );

  // React Compiler incompatible-library rule: third-party hook/value the compiler cannot analyze; usage is correct.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: displayed.length,
    getScrollElement: () => document.getElementById(APP_MAIN_SCROLL_VIEWPORT_ID),
    estimateSize: () => ROW_HEIGHT,
    overscan: Math.max(8, Math.ceil(viewportH / ROW_HEIGHT)),
    scrollMargin,
    // Keep a row reached with the arrow keys clear of the sticky header.
    scrollPaddingStart: TRACKLIST_STICKY_HEADER_PX,
    // Index-suffixed: the same track can legitimately appear twice (an album and
    // its compilation reissue), and a duplicate key would drop one of the rows.
    getItemKey: i => `${displayed[i].id}:${i}`,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();

  const warmVisibleSongs = useMemo(
    () => virtualItems.map(vi => displayed[vi.index]),
    [virtualItems, displayed],
  );
  useWarmTrackListAlbumCovers(warmVisibleSongs, COVER_ARTIST_TOP_TRACK_CSS_PX, {
    enabled: trackListCoversOn,
  });

  const handleSortClick = (key: string) => {
    if (!ARTIST_ALL_TRACKS_SORTABLE.has(key)) return;
    setSort(prev => nextArtistAllTracksSort(prev, key as ArtistAllTracksSortKey));
  };

  // Index-suffixed for the same reason as the virtualiser keys above.
  const cursorKeys = useMemo(() => displayed.map((song, i) => `${song.id}:${i}`), [displayed]);
  const cursor = useTrackListCursor({
    keys: cursorKeys,
    onActivate: index => {
      const song = displayed[index];
      if (!song) return;
      if (orbitActive) addTrackToOrbit(song.id, song.serverId);
      else onPlay(displayed, index);
    },
    scrollToIndex: index => rowVirtualizer.scrollToIndex(index, { align: 'auto' }),
  });
  const { setCursorFromClick } = cursor;

  // Latest-value box so the row callbacks stay stable across renders.
  const latest = useRef({ displayed, orbitActive, doubleClickToPlay, queueHint, addTrackToOrbit, onPlay, psyDrag, setCursorFromClick });
  latest.current = { displayed, orbitActive, doubleClickToPlay, queueHint, addTrackToOrbit, onPlay, psyDrag, setCursorFromClick };

  const cb = useMemo<ArtistAllTracksRowCallbacks>(() => ({
    activate: (song, index, e) => {
      if ((e.target as HTMLElement).closest('button, a, input')) return;
      const L = latest.current;
      L.setCursorFromClick(index, e);
      if (L.orbitActive) { L.queueHint(); return; }
      if (L.doubleClickToPlay) return;
      L.onPlay(L.displayed, index);
    },
    doubleClick: (song, index, e) => {
      if ((e.target as HTMLElement).closest('button, a, input')) return;
      const L = latest.current;
      if (L.orbitActive) L.addTrackToOrbit(song.id, song.serverId);
      else L.onPlay(L.displayed, index);
    },
    context: (song, e) => {
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, songToTrack(song), 'song');
    },
    mouseDownRow: (song, e) => {
      dragPress.arm(e, {
        canStart: ev => !(ev.target as HTMLElement).closest('button, a, input'),
        onStart: me => latest.current.psyDrag.startDrag(
          { data: JSON.stringify({ type: 'song', track: songToTrack(song) }), label: song.title },
          me.clientX, me.clientY,
        ),
      });
    },
    play: index => {
      const L = latest.current;
      if (L.orbitActive) { L.queueHint(); return; }
      L.onPlay(L.displayed, index);
    },
    startPreview: song => usePreviewStore.getState().startPreview(previewInputFromSong(song), 'artist'),
    navArtist: (artistId, serverId) => navigate(buildArtistDetailPath(artistId, { serverId })),
    navAlbum: (albumId, serverId) => {
      const query = appendServerQuery(undefined, serverId);
      navigate(query ? `/album/${albumId}?${query}` : `/album/${albumId}`);
    },
  }), [dragPress, navigate, openContextMenu]);

  if (loading && songs.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '2rem 0' }} aria-busy="true">
        {t('artistDetail.allTracksLoading')}
      </div>
    );
  }
  if (displayed.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '2rem 0' }}>
        {t(failed ? 'artistDetail.allTracksUnavailable' : 'artistDetail.allTracksEmpty')}
      </div>
    );
  }

  const handleAutofit = (colIndex: number) => {
    const col = visibleCols[colIndex];
    const root = tracklistRef.current;
    if (!col || !root) return;
    const content = measureColumnContent(root, col.key, songColumnTexts(displayed, col.key));
    setColumnWidth(col.key, fittedWidth(content, col.minWidth));
  };

  const header = (
    <TracklistHeader
      cols={visibleCols}
      gridStyle={gridStyle}
      renderLabel={col => {
        if (col.key === 'num') return <span className="track-num"><span className="track-num-number">#</span></span>;
        return col.i18nKey ? t(`albumDetail.${col.i18nKey}`) : '';
      }}
      sort={sort.key !== 'natural' ? { key: sort.key, dir: sort.dir } : null}
      isSortable={key => ARTIST_ALL_TRACKS_SORTABLE.has(key)}
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
        allColumns: ARTIST_ALL_TRACKS_COLUMNS,
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
      <div className="tracklist tracklist--model-a" data-preview-loc="artist" style={{ padding: 0 }} ref={tracklistRef} {...cursor.listProps}>
        <TracklistViewport contentWidth={contentWidth} header={header}>
        <div ref={listWrapRef} style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {virtualItems.map(vi => {
            const song = displayed[vi.index];
            const isActive = sameQueueTrack(currentTrack, song);
            return (
              <div
                key={vi.key}
                ref={rowVirtualizer.measureElement}
                data-index={vi.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start - rowVirtualizer.options.scrollMargin}px)`,
                }}
              >
                <ArtistAllTracksRow
                  song={song}
                  index={vi.index}
                  visibleCols={visibleCols}
                  gridStyle={gridStyle}
                  showBitrate={showBitrate}
                  isActive={isActive}
                  showEq={isActive && isPlaying}
                  isPreviewing={previewingId === song.id}
                  previewStarted={previewingId === song.id && previewAudioStarted}
                  doubleClickActive={orbitActive || doubleClickToPlay}
                  cursorRowId={cursor.cursorIndex === vi.index ? cursor.cursorRowId : undefined}
                  cb={cb}
                />
              </div>
            );
          })}
        </div>
        </TracklistViewport>
      </div>
  );
}
