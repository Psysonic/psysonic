import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AudioLines, ChevronRight, Play, Square } from 'lucide-react';
import type { SubsonicAlbum, SubsonicSong } from '@/lib/api/subsonicTypes';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { previewInputFromSong, usePreviewStore } from '@/features/playback/store/previewStore';
import { useOrbitSongRowBehavior } from '@/features/orbit';
import { songToTrack } from '@/lib/media/songToTrack';
import { formatTrackTime } from '@/lib/format/formatDuration';
import { useDragDrop } from '@/lib/dnd/DragDropContext';
import { useDragPressHandle } from '@/lib/dnd/useDragPress';
import { useTrackListCursor } from '@/lib/hooks/useTrackListCursor';
import { fittedWidth, useTracklistColumns, type ColDef } from '@/lib/hooks/useTracklistColumns';
import ArtistTopTrackCover from '@/features/artist/components/ArtistTopTrackCover';
import { topSongAlbumForCover } from '@/features/artist/components/topSongAlbumForCover';
import {
  ARTIST_TOP_TRACKS_COLUMNS,
  ARTIST_TOP_TRACKS_STORAGE_KEY,
} from '@/features/artist/utils/artistAllTracksColumns';
import { ExplicitTitle } from '@/ui/ExplicitBadge';
import ExplicitCoverVeil from '@/ui/ExplicitCoverVeil';
import { isExplicit } from '@/lib/media/explicitStatus';
import { TracklistHeader } from '@/ui/tracklist/TracklistHeader';
import { TracklistViewport } from '@/ui/tracklist/TracklistViewport';
import { TracklistCell } from '@/ui/tracklist/TracklistCell';
import { measureColumnContent, songCellText, songColumnTexts } from '@/ui/tracklist/measureColumnContent';

interface Props {
  topSongs: SubsonicSong[];
  loading?: boolean;
  albums: SubsonicAlbum[];
  playTopSongWithContinuation: (startIndex: number) => Promise<void>;
}

/**
 * The server's popularity ranking for an artist. Named and spaced by the tab
 * strip above it, so it renders the table alone.
 */
export default function ArtistDetailTopTracks({
  topSongs, loading = false, albums, playTopSongWithContinuation,
}: Props) {
  const { t } = useTranslation();
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const openContextMenu = usePlayerStore(s => s.openContextMenu);
  const previewingId = usePreviewStore(s => s.previewingId);
  const previewAudioStarted = usePreviewStore(s => s.audioStarted);
  const { orbitActive, doubleClickToPlay, queueHint, addTrackToOrbit } = useOrbitSongRowBehavior();
  const psyDrag = useDragDrop();
  const dragPress = useDragPressHandle();
  const {
    visibleCols, gridStyle, colWidths, contentWidth, colVisible, setColumnWidth, startResize,
    moveColumn, toggleColumn, resetColumns, tracklistRef,
  } = useTracklistColumns(ARTIST_TOP_TRACKS_COLUMNS, ARTIST_TOP_TRACKS_STORAGE_KEY);
  const cursorKeys = useMemo(() => topSongs.map((song, idx) => `${song.id}:${idx}`), [topSongs]);
  const cursor = useTrackListCursor({
    keys: cursorKeys,
    onActivate: idx => {
      const song = topSongs[idx];
      if (!song) return;
      if (orbitActive) addTrackToOrbit(song.id, song.serverId);
      else void playTopSongWithContinuation(idx);
    },
  });

  // The offline and local-index branches leave the ranking empty while the full
  // list still has tracks. Without this the tab would show a bare header row —
  // and it must not claim the artist has no tracks, because the neighbouring tab
  // may well be listing hundreds. Only the ranking is missing.
  if (!loading && topSongs.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '2rem 0' }}>
        {t('artistDetail.topTracksEmpty')}
      </div>
    );
  }

  const handleAutofit = (colIndex: number) => {
    const col = visibleCols[colIndex];
    const root = tracklistRef.current;
    if (!col || !root) return;
    const content = measureColumnContent(root, col.key, songColumnTexts(topSongs, col.key));
    setColumnWidth(col.key, fittedWidth(content, col.minWidth));
  };

  const header = (
    <TracklistHeader
      cols={visibleCols}
      gridStyle={gridStyle}
      renderLabel={col => (col.key === 'num' ? '#' : col.i18nKey ? t(`albumDetail.${col.i18nKey}`) : '')}
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
        allColumns: ARTIST_TOP_TRACKS_COLUMNS,
        colVisible,
        toggleColumn,
        resetColumns,
        onFitAll: () => visibleCols.forEach((_, i) => handleAutofit(i)),
      }}
      widthOf={key => colWidths[key] ?? 0}
      t={t}
    />
  );

  const renderCell = (col: ColDef, song: SubsonicSong, idx: number) => {
    switch (col.key) {
      case 'num':
        return (
          <div className={`track-num${currentTrack?.id === song.id ? ' track-num-active' : ''}`}>
            {currentTrack?.id === song.id && isPlaying ? (
              <span className="track-num-eq"><AudioLines className="eq-bars" size={14} /></span>
            ) : (
              <span className="track-num-number">{idx + 1}</span>
            )}
          </div>
        );
      case 'title': {
        const albumForCover = topSongAlbumForCover(song, albums);
        return (
          <div className="track-info track-info-suggestion" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              type="button"
              className="playlist-suggestion-play-btn"
              onClick={e => { e.stopPropagation(); if (orbitActive) { queueHint(); return; } playTopSongWithContinuation(idx); }}
              data-tooltip={t('common.play')}
              aria-label={t('common.play')}
            >
              <Play size={10} fill="currentColor" strokeWidth={0} className="playlist-suggestion-play-icon" />
            </button>
            <button
              type="button"
              className={`playlist-suggestion-preview-btn${previewingId === song.id ? ' is-previewing' : ''}${previewingId === song.id && previewAudioStarted ? ' audio-started' : ''}`}
              onClick={e => { e.stopPropagation(); usePreviewStore.getState().startPreview(previewInputFromSong(song), 'artist'); }}
              data-tooltip={previewingId === song.id ? t('playlists.previewStop') : t('playlists.preview')}
              aria-label={previewingId === song.id ? t('playlists.previewStop') : t('playlists.preview')}
            >
              <svg className="playlist-suggestion-preview-ring" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10.5" className="playlist-suggestion-preview-ring-track" />
                <circle cx="12" cy="12" r="10.5" className="playlist-suggestion-preview-ring-progress" />
              </svg>
              {previewingId === song.id
                ? <Square size={9} fill="currentColor" strokeWidth={0} className="playlist-suggestion-preview-icon" />
                : <ChevronRight size={14} className="playlist-suggestion-preview-icon playlist-suggestion-preview-icon-play" />}
            </button>
            {albumForCover ? <ArtistTopTrackCover album={albumForCover} /> : null}
            <ExplicitCoverVeil explicit={isExplicit(song)} />
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <ExplicitTitle status={song.explicitStatus}>
                <div className="track-title">{song.title}</div>
              </ExplicitTitle>
            </div>
          </div>
        );
      }
      case 'album':
        return (
          <div className="track-album truncate" style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
            {song.album}
          </div>
        );
      case 'duration':
        return <div className="track-duration">{formatTrackTime(song.duration)}</div>;
      default:
        return null;
    }
  };

  const renderSkeletonCell = (col: ColDef) => {
    switch (col.key) {
      case 'num': return <div className="artist-top-track-skeleton-rank" />;
      case 'title':
        return (
          <div className="artist-top-track-skeleton-title">
            <div className="artist-top-track-skeleton-cover" />
            <div className="artist-top-track-skeleton-line artist-top-track-skeleton-line--title" />
          </div>
        );
      case 'album': return <div className="artist-top-track-skeleton-line artist-top-track-skeleton-line--album" />;
      case 'duration': return <div className="artist-top-track-skeleton-line artist-top-track-skeleton-line--duration" />;
      default: return null;
    }
  };

  return (
    <div
      className="tracklist tracklist--model-a"
      data-preview-loc="artist"
      aria-busy={loading}
      style={{ padding: 0 }}
      ref={tracklistRef}
      {...cursor.listProps}
    >
      <TracklistViewport contentWidth={contentWidth} header={header}>
        {loading && topSongs.length === 0 ? Array.from({ length: 5 }, (_, idx) => (
          <div
            key={idx}
            className="track-row artist-top-track-skeleton"
            style={gridStyle}
            aria-hidden="true"
          >
            {visibleCols.map(col => <TracklistCell key={col.key} col={col}>{renderSkeletonCell(col)}</TracklistCell>)}
          </div>
        )) : topSongs.map((song, idx) => {
          const track = songToTrack(song);
          return (
            <div
              key={`${song.id}-${idx}`}
              id={cursor.cursorIndex === idx ? cursor.cursorRowId : undefined}
              className={`track-row track-row-with-actions${cursor.cursorIndex === idx ? ' track-row--cursor' : ''}`}
              style={gridStyle}
              onClick={e => {
                if ((e.target as HTMLElement).closest('button, a, input')) return;
                cursor.setCursorFromClick(idx, e);
                if (orbitActive) { queueHint(); return; }
                if (doubleClickToPlay) return;
                playTopSongWithContinuation(idx);
              }}
              onDoubleClick={orbitActive || doubleClickToPlay ? e => {
                if ((e.target as HTMLElement).closest('button, a, input')) return;
                if (orbitActive) addTrackToOrbit(song.id, song.serverId);
                else playTopSongWithContinuation(idx);
              } : undefined}
              onContextMenu={(e) => {
                e.preventDefault();
                openContextMenu(e.clientX, e.clientY, track, 'song');
              }}
              onMouseDown={e => {
                dragPress.arm(e, {
                  canStart: ev => !(ev.target as HTMLElement).closest('button, a, input'),
                  onStart: me => psyDrag.startDrag(
                    { data: JSON.stringify({ type: 'song', track }), label: song.title },
                    me.clientX, me.clientY,
                  ),
                });
              }}
            >
              {visibleCols.map(col => (
                <TracklistCell key={col.key} col={col} text={songCellText(song, col.key)}>
                  {renderCell(col, song, idx)}
                </TracklistCell>
              ))}
            </div>
          );
        })}
      </TracklistViewport>
    </div>
  );
}
