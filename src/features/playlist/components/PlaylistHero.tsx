import React, { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import {
  Camera, ChevronLeft, Download, FileUp, Globe, HardDriveDownload, ListPlus,
  Loader2, Lock, Pencil, Play, RefreshCw, Search, Shuffle, Sparkles, Trash2,
} from 'lucide-react';
import type { SubsonicPlaylist, SubsonicSong } from '@/lib/api/subsonicTypes';
import type { ZipDownload } from '@/features/offline';
import type { AlbumOfflineStatus } from '@/features/album';
import { dequeueOfflinePin } from '@/features/offline';
import { useThemeStore } from '@/store/themeStore';
import { usePlaylistLayoutStore, type PlaylistLayoutItemId } from '@/features/playlist/store/playlistLayoutStore';
import { formatSize, totalDurationLabel } from '@/lib/format/playlistDetailHelpers';
import { isSmartPlaylist, playlistDisplayName } from '@/lib/format/playlistClassification';
import { playlistDetailControls } from '@/features/playlist/utils/playlistSmartUx';
import { playlistsOpenSmartEditorState } from '@/features/playlist/utils/playlistOwnedMutation';
import type { CoverArtId } from '@/cover/types';
import { AlbumCoverArtImage } from '@/cover/AlbumCoverArtImage';
import { PLAYLIST_MAIN_COVER_CSS_PX } from '@/features/playlist/hooks/usePlaylistCovers';
import { PlaylistSmartCoverCell } from '@/features/playlist/components/PlaylistCoverImages';
import type { OfflineActionPolicy } from '@/features/offline';
import { coverServerScopeForServerId } from '@/cover/serverScope';
import { ShareMethodMenuButton } from '@/features/share';
import { tooltipAttrs } from '@/ui/tooltipAttrs';

interface Props {
  playlist: SubsonicPlaylist;
  songs: SubsonicSong[];
  id: string | undefined;
  customCoverId: string | null;
  coverQuadIds: (CoverArtId | null)[];
  resolvedBgUrl: string | null;
  saving: boolean;
  refreshingSmart: boolean;
  searchOpen: boolean;
  csvImporting: boolean;
  activeZip: ZipDownload | undefined;
  offlineStatus: AlbumOfflineStatus;
  offlineProgress: { done: number; total: number } | null;
  activeServerId: string;
  actionPolicy: OfflineActionPolicy;
  setEditingMeta: React.Dispatch<React.SetStateAction<boolean>>;
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setSearchResults: React.Dispatch<React.SetStateAction<SubsonicSong[]>>;
  setSelectedSearchIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSearchPlPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handlePlayAll: () => void;
  handleShuffleAll: () => void;
  handleEnqueueAll: () => void;
  handleImportCsv: () => void;
  handleDownload: () => void;
  handleRefreshSmart: () => void;
  deleteAlbum: (
    id: string,
    serverId: string,
    pinSource?: { kind: 'playlist'; sourceId: string },
  ) => void;
  downloadPlaylist: (
    id: string,
    name: string,
    coverArt: string | undefined,
    songs: SubsonicSong[],
    serverId: string,
    smart?: boolean,
  ) => void;
}

export default function PlaylistHero({
  playlist, songs, id,
  customCoverId, coverQuadIds,
  resolvedBgUrl, saving, refreshingSmart, searchOpen, csvImporting, activeZip,
  offlineStatus, offlineProgress, activeServerId, actionPolicy,
  setEditingMeta, setSearchOpen, setSearchQuery, setSearchResults,
  setSelectedSearchIds, setSearchPlPickerOpen,
  handlePlayAll, handleShuffleAll, handleEnqueueAll, handleImportCsv, handleDownload,
  handleRefreshSmart,
  deleteAlbum, downloadPlaylist,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const enableCoverArtBackground = useThemeStore(s => s.enableCoverArtBackground);
  const enablePlaylistCoverPhoto = useThemeStore(s => s.enablePlaylistCoverPhoto);
  const layoutItems = usePlaylistLayoutStore(s => s.items);
  const controls = playlistDetailControls(playlist);
  const totalBytes = songs.reduce((acc, s) => acc + (s.size ?? 0), 0);

  // One entry per action-bar id; `null` when the button does not apply here.
  // `suggestions` is a page section, not a bar button, so it never renders.
  const renderActionButton = (itemId: PlaylistLayoutItemId): React.ReactNode => {
    switch (itemId) {
      case 'shuffle':
        return (
          <button
            className="btn btn-ghost"
            disabled={songs.length === 0}
            onClick={handleShuffleAll}
            {...tooltipAttrs(t('playlists.shuffle', 'Shuffle'))}
          >
            <Shuffle size={16} />
          </button>
        );
      case 'enqueue':
        return (
          <button
            className="btn btn-ghost"
            disabled={songs.length === 0}
            onClick={handleEnqueueAll}
            {...tooltipAttrs(t('playlists.addToQueue'))}
          >
            <ListPlus size={16} />
          </button>
        );
      case 'share':
        return (
          <ShareMethodMenuButton
            request={{
              kind: 'playlist',
              resourceIds: [playlist.id],
              serverIds: [playlist.serverId ?? activeServerId].filter(Boolean),
            }}
            className="btn btn-ghost"
            label={t('contextMenu.shareLink')}
          />
        );
      case 'refreshSmart':
        return actionPolicy.canEditPlaylist && controls.showRefreshTracks ? (
          <button
            className="btn btn-ghost"
            onClick={handleRefreshSmart}
            disabled={refreshingSmart}
            {...tooltipAttrs(t('playlists.refreshSmart'))}
          >
            <RefreshCw size={16} className={refreshingSmart ? 'is-spinning' : undefined} />
          </button>
        ) : null;
      case 'editRules':
        return actionPolicy.canEditPlaylist && controls.showEditRules ? (
          <button
            className="btn btn-ghost"
            onClick={() => {
              const dest = playlistsOpenSmartEditorState(playlist);
              if (dest) navigate(dest.pathname, { state: dest.state });
            }}
            {...tooltipAttrs(t('playlists.editRules'))}
          >
            <Sparkles size={16} />
          </button>
        ) : null;
      case 'addSongs':
        return actionPolicy.canEditPlaylist && controls.canAddTracks ? (
          <button
            className={`btn btn-ghost ${searchOpen ? 'active' : ''}`}
            onClick={() => { setSearchOpen(v => !v); setSearchQuery(''); setSearchResults([]); setSelectedSearchIds(new Set()); setSearchPlPickerOpen(false); }}
            {...tooltipAttrs(t('playlists.addSongsTooltip'))}
          >
            <Search size={16} />
          </button>
        ) : null;
      case 'importCsv':
        return actionPolicy.canEditPlaylist && controls.canImportCsv ? (
          <button
            className="btn btn-ghost"
            onClick={handleImportCsv}
            disabled={csvImporting}
            {...tooltipAttrs(t('playlists.importCSVTooltip'))}
          >
            {csvImporting ? <Loader2 size={16} className="spin-slow" /> : <FileUp size={16} />}
          </button>
        ) : null;
      case 'downloadZip':
        if (!actionPolicy.canDownload || songs.length === 0) return null;
        return activeZip && !activeZip.done && !activeZip.error ? (
          <div className="download-progress-wrap">
            <Download size={14} />
            <div className="download-progress-bar">
              <div className="download-progress-fill" style={{ width: `${activeZip.total ? Math.round((activeZip.bytes / activeZip.total) * 100) : 0}%` }} />
            </div>
            <span className="download-progress-pct">{activeZip.total ? Math.round((activeZip.bytes / activeZip.total) * 100) : '…'}%</span>
          </div>
        ) : (
          <button
            className="btn btn-ghost"
            onClick={handleDownload}
            {...tooltipAttrs(`${t('playlists.downloadZip')}${totalBytes > 0 ? ` · ${formatSize(totalBytes)}` : ''}`)}
          >
            <Download size={16} />
          </button>
        );
      case 'offlineCache':
        if (!actionPolicy.canPinOffline || songs.length === 0 || !id) return null;
        if (!controls.canPinNewOfflineCache && offlineStatus === 'none') return null;
        if (offlineStatus === 'downloading') {
          return (
            <div
              className="btn btn-ghost"
              role="status"
              style={{ cursor: 'default', opacity: 0.75 }}
              {...tooltipAttrs(t('albumDetail.offlineDownloading', { n: offlineProgress?.done ?? 0, total: offlineProgress?.total ?? 0 }))}
            >
              <div className="spinner" style={{ width: 14, height: 14, borderTopColor: 'currentColor' }} />
            </div>
          );
        }
        return (
          <button
            className={`btn btn-ghost${offlineStatus === 'cached' ? ' btn-danger' : ''}${offlineStatus === 'queued' ? ' offline-cache-btn--queued' : ''}`}
            onClick={() => {
              if (offlineStatus === 'cached') {
                deleteAlbum(id, activeServerId, { kind: 'playlist', sourceId: id });
              } else if (offlineStatus === 'queued') {
                dequeueOfflinePin(id, activeServerId);
              } else {
                downloadPlaylist(id, playlist.name, playlist.coverArt, songs, activeServerId, playlist.smart);
              }
            }}
            {...tooltipAttrs(offlineStatus === 'queued'
              ? t('albumDetail.removeFromOfflineQueue')
              : offlineStatus === 'cached'
                ? t('playlists.removeOffline')
                : t('playlists.cacheOffline'))}
          >
            {offlineStatus === 'cached' ? <Trash2 size={16} /> : <HardDriveDownload size={16} />}
          </button>
        );
      case 'suggestions':
        return null;
    }
  };

  return (
    <div className="album-detail-header">
      {resolvedBgUrl && enableCoverArtBackground && (
        <>
          <div className="album-detail-bg" style={{ backgroundImage: `url(${resolvedBgUrl})` }} aria-hidden="true" />
          <div className="album-detail-overlay" aria-hidden="true" />
        </>
      )}

      <div className="album-detail-content">
        <button className="btn btn-ghost album-detail-back" onClick={() => navigate('/playlists')}>
          <ChevronLeft size={16} /> {t('playlists.title')}
        </button>

        <div className="album-detail-hero">
          {/* Cover — click to open edit modal */}
          {enablePlaylistCoverPhoto && (
            <div
              className="playlist-hero-cover"
              onClick={() => { if (actionPolicy.canEditPlaylist) setEditingMeta(true); }}
            >
              {customCoverId ? (
                <AlbumCoverArtImage
                  albumId={customCoverId}
                  coverArt={customCoverId}
                  serverScope={coverServerScopeForServerId(activeServerId)}
                  displayCssPx={PLAYLIST_MAIN_COVER_CSS_PX}
                  surface="dense"
                  libraryResolve={false}
                  alt=""
                  className="playlist-cover-grid"
                  style={{ objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <div className="playlist-cover-grid">
                  {coverQuadIds.map((coverId, i) =>
                    coverId
                      ? <PlaylistSmartCoverCell key={i} coverId={coverId} serverId={activeServerId} />
                      : <div key={i} className="playlist-cover-cell playlist-cover-cell--empty" />
                  )}
                </div>
              )}
              <div className="playlist-hero-cover-overlay">
                <Camera size={28} />
              </div>
            </div>
          )}

          <div className="album-detail-meta">
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h1 className="album-detail-title" style={{ marginBottom: 0, marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isSmartPlaylist(playlist) && <Sparkles size={16} style={{ color: 'var(--text-muted)' }} />}
                  <span>{playlistDisplayName(playlist)}</span>
                </h1>
                {actionPolicy.canEditPlaylist && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => setEditingMeta(true)}
                    data-tooltip={t('playlists.editMeta')}
                    style={{ padding: '4px 6px', opacity: 0.7, flexShrink: 0 }}
                  >
                    <Pencil size={14} />
                  </button>
                )}
              </div>
              {playlist.comment && (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{playlist.comment}</div>
              )}
            </>
            <div className="album-detail-info">
              <span>{t('playlists.songs', { count: songs.length })}</span>
              {songs.length > 0 && <span>· {totalDurationLabel(songs)}</span>}
              {playlist.public !== undefined && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  · {playlist.public
                    ? <><Globe size={11} /> {t('playlists.publicLabel')}</>
                    : <><Lock size={11} /> {t('playlists.privateLabel')}</>}
                </span>
              )}
              {saving && <Loader2 size={12} className="spin-slow" style={{ display: 'inline', marginLeft: 4 }} />}
            </div>
            <div className="album-detail-actions compact-action-bar">
              <div className="album-detail-actions-primary">
                <button
                  className="btn btn-primary"
                  disabled={songs.length === 0}
                  onClick={handlePlayAll}
                  aria-label={t('playlists.playTooltip')}
                  data-tooltip={t('playlists.playTooltip')}
                >
                  <Play size={15} /> <span className="compact-btn-label">{t('common.play', 'Reproducir')}</span>
                </button>
                {layoutItems.map(item => {
                  if (!item.visible) return null;
                  const node = renderActionButton(item.id);
                  return node ? <Fragment key={item.id}>{node}</Fragment> : null;
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
