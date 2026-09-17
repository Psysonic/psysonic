import { useEffect, useState } from 'react';
import { ListMusic, ListPlus, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AlbumCoverArtImage } from '@/cover/AlbumCoverArtImage';
import { coverServerScopeForServerId } from '@/cover/serverScope';
import type { SubsonicShare } from '@/lib/api/subsonicSharing';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { songToTrack } from '@/lib/media/songToTrack';
import { usePlayerStore } from '@/features/playback';
import { loadShareSongs } from '@/features/share/loadShareSongs';
import { shareResourceKindLabel, shareResourceSummary } from '@/features/share/sharePresentation';
import ShareTrackList from '@/features/share/components/ShareTrackList';
import Modal from '@/ui/Modal';

interface ShareContentsModalProps {
  open: boolean;
  onClose: () => void;
  serverId: string;
  share: SubsonicShare;
  title?: string;
}

interface ContentsState {
  loading: boolean;
  songs: SubsonicSong[];
  failedEntries: number;
}

export default function ShareContentsModal({
  open,
  onClose,
  serverId,
  share,
  title,
}: ShareContentsModalProps) {
  const { t } = useTranslation();
  const [contents, setContents] = useState<ContentsState>({ loading: true, songs: [], failedEntries: 0 });
  const [busyAction, setBusyAction] = useState<'play' | 'queue' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void loadShareSongs(serverId, share).then(next => {
      if (active) setContents({ ...next, loading: false });
    });
    return () => {
      active = false;
    };
  }, [open, serverId, share]);

  const runPlaybackAction = (action: 'play' | 'queue') => {
    if (contents.songs.length === 0 || busyAction) return;
    setBusyAction(action);
    setActionError(null);
    try {
      const tracks = contents.songs.map(songToTrack);
      if (action === 'play') usePlayerStore.getState().playTrack(tracks[0]!, tracks);
      else usePlayerStore.getState().enqueue(tracks);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title || shareResourceKindLabel(share, t)}
      subtitle={shareResourceSummary(share, t)}
      icon={<ListMusic size={16} aria-hidden="true" />}
      size="lg"
      closeLabel={t('common.close')}
    >
      <div className="shared-contents-modal">
        <div className="shared-contents-modal__toolbar compact-action-bar">
          <button
            type="button"
            className="btn btn-primary"
            disabled={contents.loading || contents.songs.length === 0 || busyAction !== null}
            onClick={() => runPlaybackAction('play')}
          >
            <Play size={15} fill="currentColor" aria-hidden="true" />
            {t('common.play')}
          </button>
          <button
            type="button"
            className="btn btn-surface"
            disabled={contents.loading || contents.songs.length === 0 || busyAction !== null}
            onClick={() => runPlaybackAction('queue')}
          >
            <ListPlus size={15} aria-hidden="true" />
            {t('common.addToQueue')}
          </button>
        </div>
        {actionError && <div className="shared-contents-modal__warning" role="alert">{actionError}</div>}
        {contents.loading && <div className="shared-contents-modal__state">{t('common.loading')}</div>}
        {!contents.loading && contents.failedEntries > 0 && (
          <div className="shared-contents-modal__warning" role="alert">{t('shared.contentsLoadFailed')}</div>
        )}
        {!contents.loading && contents.songs.length === 0 && (
          <div className="shared-contents-modal__state">{t('shared.contentsEmpty')}</div>
        )}
        {!contents.loading && contents.songs.length > 0 && (
          <ShareTrackList items={contents.songs.map((song, index) => ({
            id: song.id,
            title: song.title,
            artist: song.artist,
            album: song.album,
            duration: song.duration,
            number: song.track ?? index + 1,
            cover: song.coverArt || song.albumId ? (
              <AlbumCoverArtImage
                albumId={song.albumId || song.id}
                coverArt={song.coverArt}
                serverScope={coverServerScopeForServerId(serverId)}
                displayCssPx={48}
                surface="dense"
                className="shared-contents-modal__cover"
                alt=""
              />
            ) : undefined,
          }))} />
        )}
      </div>
    </Modal>
  );
}
