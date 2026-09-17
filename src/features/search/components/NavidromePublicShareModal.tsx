import { ExternalLink, ListMusic, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { open as openUrl } from '@tauri-apps/plugin-shell';
import type { NavidromePublicShareRef } from '@/lib/share/navidromePublicShareUrl';
import type { NavidromePublicSharePreviewState } from '@/features/search/hooks/useNavidromePublicSharePreview';
import { ShareTrackList } from '@/features/share';
import Modal from '@/ui/Modal';

type NavidromePublicShareModalProps = {
  open: boolean;
  onClose: () => void;
  publicShareRef: NavidromePublicShareRef;
  preview: NavidromePublicSharePreviewState;
  hostLabel?: string | null;
  onPlay: () => void;
  playBusy: boolean;
};

function navidromeShareErrorMessage(
  reason: NonNullable<NavidromePublicSharePreviewState['navidromeShareError']>,
  t: (key: string) => string,
): string {
  switch (reason) {
    case 'not-found':
      return t('sharePaste.navidromeShareNotFound');
    case 'expired':
      return t('sharePaste.navidromeShareExpired');
    case 'unreachable':
      return t('sharePaste.navidromeShareUnreachable');
    default:
      return t('sharePaste.navidromeShareMalformed');
  }
}

export default function NavidromePublicShareModal({
  open,
  onClose,
  publicShareRef: shareRef,
  preview,
  hostLabel,
  onPlay,
  playBusy,
}: NavidromePublicShareModalProps) {
  const { t } = useTranslation();
  const info = preview.navidromeShareInfo;
  const count = info?.tracks.length ?? 0;
  const title = info?.description?.trim() || t('sharePaste.navidromeShareTitle', { count: count || 1 });
  const subtitle = [
    hostLabel ? t('search.shareFromServer', { server: hostLabel }) : null,
    count > 0 ? t('shared.resources', { count }) : null,
  ].filter(Boolean).join(' · ');
  const canPlay = Boolean(info && info.tracks.length > 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle || undefined}
      icon={<ListMusic size={16} aria-hidden="true" />}
      size="lg"
      closeLabel={t('common.close')}
    >
      <div className="shared-contents-modal">
        <div className="shared-contents-modal__toolbar compact-action-bar">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canPlay || playBusy}
            onClick={() => void onPlay()}
          >
            <Play size={15} fill="currentColor" aria-hidden="true" />
            {playBusy ? t('sharePaste.navidromeSharePlaying') : t('sharePaste.navidromeSharePlay')}
          </button>
          <button
            type="button"
            className="btn btn-surface"
            onClick={() => void openUrl(shareRef.pageUrl)}
          >
            <ExternalLink size={15} aria-hidden="true" />
            {t('sharePaste.openInBrowser')}
          </button>
        </div>

        {preview.navidromeShareResolving && (
          <div className="shared-contents-modal__state">{t('sharePaste.navidromeShareLoading')}</div>
        )}
        {preview.navidromeShareError && (
          <div className="shared-contents-modal__warning" role="alert">
            {navidromeShareErrorMessage(preview.navidromeShareError, t)}
          </div>
        )}
        {!preview.navidromeShareResolving && !preview.navidromeShareError && !info && (
          <div className="shared-contents-modal__warning" role="alert">
            {t('sharePaste.navidromeShareMalformed')}
          </div>
        )}
        {info && info.tracks.length === 0 && (
          <div className="shared-contents-modal__state">{t('shared.contentsEmpty')}</div>
        )}
        {info && info.tracks.length > 0 && (
          <ShareTrackList items={info.tracks.map((track, index) => ({
            ...track,
            number: index + 1,
            cover: info.imageUrl ? (
              <img src={info.imageUrl} alt="" className="shared-contents-modal__cover" />
            ) : undefined,
          }))} />
        )}
      </div>
    </Modal>
  );
}
