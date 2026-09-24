import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, HardDriveDownload, Heart, Highlighter, ListPlus, Loader2, Play, Shuffle } from 'lucide-react';
import { tooltipAttrs } from '@/ui/tooltipAttrs';
import { formatMb } from '@/lib/format/formatBytes';
import type { OfflineActionPolicy } from '@/features/offline';
import { ShareMethodMenuButton } from '@/features/share';
import {
  useAlbumHeaderLayoutStore,
  type AlbumHeaderButtonId,
} from '@/features/album/store/albumHeaderLayoutStore';

interface Props {
  albumId: string;
  serverId?: string;
  policy: OfflineActionPolicy;
  isStarred: boolean;
  showBioButton: boolean;
  totalSize: number;
  downloadProgress: number | null;
  offlineStatus: 'none' | 'queued' | 'downloading' | 'cached';
  offlineProgress: { done: number; total: number } | null;
  onPlayAll: () => void;
  onShuffleAll?: () => void;
  onEnqueueAll: () => void;
  onToggleStar: () => void;
  onBio: () => void;
  onDownload: () => void;
  onCacheOffline: () => void;
  onRemoveOffline: () => void;
}

/**
 * Desktop action bar of the album detail page: the fixed Play button, then the
 * icon-only buttons in the order and visibility set under Personalisation.
 */
export default function AlbumHeaderActionBar({
  albumId, serverId, policy, isStarred, showBioButton, totalSize,
  downloadProgress, offlineStatus, offlineProgress,
  onPlayAll, onShuffleAll, onEnqueueAll, onToggleStar, onBio, onDownload,
  onCacheOffline, onRemoveOffline,
}: Props) {
  const { t } = useTranslation();
  const buttons = useAlbumHeaderLayoutStore(s => s.buttons);

  const renderButton = (id: AlbumHeaderButtonId): ReactNode => {
    switch (id) {
      case 'shuffle':
        return onShuffleAll ? (
          <button className="btn btn-surface" onClick={onShuffleAll} {...tooltipAttrs(t('playlists.shuffle', 'Shuffle'))}>
            <Shuffle size={16} />
          </button>
        ) : null;
      case 'enqueue':
        return (
          <button className="btn btn-surface" onClick={onEnqueueAll} {...tooltipAttrs(t('albumDetail.enqueueTooltip'))}>
            <ListPlus size={16} />
          </button>
        );
      case 'favorite':
        return policy.canFavorite ? (
          <button
            className={`btn btn-surface${isStarred ? ' is-starred' : ''}`}
            onClick={onToggleStar}
            {...tooltipAttrs(isStarred ? t('albumDetail.favoriteRemove') : t('albumDetail.favoriteAdd'))}
          >
            <Heart size={16} fill={isStarred ? 'currentColor' : 'none'} />
          </button>
        ) : null;
      case 'share':
        return (
          <ShareMethodMenuButton
            request={{ kind: 'album', resourceIds: [albumId], serverIds: serverId ? [serverId] : [] }}
            className="btn btn-surface"
            label={t('albumDetail.shareAlbum')}
          />
        );
      case 'bio':
        return showBioButton && policy.canShowBio ? (
          <button className="btn btn-surface" id="album-bio-btn" onClick={onBio} {...tooltipAttrs(t('albumDetail.artistBioTooltip'))}>
            <Highlighter size={16} />
          </button>
        ) : null;
      case 'download':
        if (!policy.canDownload) return null;
        return downloadProgress !== null ? (
          <div className="download-progress-wrap">
            <Download size={14} />
            <div className="download-progress-bar">
              <div className="download-progress-fill" style={{ width: `${downloadProgress}%` }} />
            </div>
            <span className="download-progress-pct">{downloadProgress}%</span>
          </div>
        ) : (
          <button
            className="btn btn-surface"
            id="album-download-btn"
            onClick={onDownload}
            {...tooltipAttrs(`${t('albumDetail.downloadTooltip')}${totalSize > 0 ? ` · ${formatMb(totalSize)}` : ''}`)}
          >
            <Download size={16} />
          </button>
        );
      case 'offline':
        if (!policy.canPinOffline) return null;
        if (offlineStatus === 'downloading' && offlineProgress) {
          return (
            <div
              className="btn btn-surface offline-cache-btn"
              role="status"
              style={{ cursor: 'default', opacity: 0.75 }}
              {...tooltipAttrs(t('albumDetail.offlineDownloading', { n: offlineProgress.done, total: offlineProgress.total }))}
            >
              <Loader2 size={16} className="spin" />
            </div>
          );
        }
        if (offlineStatus === 'queued') {
          return (
            <button
              className="btn btn-surface offline-cache-btn offline-cache-btn--queued"
              onClick={onCacheOffline}
              aria-label={t('albumDetail.offlineQueued')}
              data-tooltip={t('albumDetail.removeFromOfflineQueue')}
            >
              <HardDriveDownload size={16} />
            </button>
          );
        }
        if (offlineStatus === 'cached') {
          return (
            <button
              className="btn btn-surface offline-cache-btn offline-cache-btn--cached"
              onClick={onRemoveOffline}
              aria-label={t('albumDetail.offlineCached')}
              data-tooltip={t('albumDetail.removeOffline')}
            >
              <HardDriveDownload size={16} />
            </button>
          );
        }
        return (
          <button
            className="btn btn-surface offline-cache-btn"
            onClick={onCacheOffline}
            {...tooltipAttrs(t('albumDetail.cacheOffline'))}
          >
            <HardDriveDownload size={16} />
          </button>
        );
    }
  };

  return (
    <div className="album-detail-actions compact-action-bar">
      <div className="album-detail-actions-primary">
        <button
          className="btn btn-primary"
          id="album-play-all-btn"
          onClick={onPlayAll}
          {...tooltipAttrs(t('albumDetail.playTooltip'))}
        >
          <Play size={15} /> <span className="compact-btn-label">{t('common.play', 'Reproducir')}</span>
        </button>
        {buttons.map(btn => {
          if (!btn.visible) return null;
          const node = renderButton(btn.id);
          return node ? <Fragment key={btn.id}>{node}</Fragment> : null;
        })}
      </div>
    </div>
  );
}
