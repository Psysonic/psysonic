import { useEffect, useState } from 'react';
import { ListMusic, Music } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AlbumCoverArtImage } from '@/cover/AlbumCoverArtImage';
import { coverServerScopeForServerId } from '@/cover/serverScope';
import { getAlbumForServer } from '@/lib/api/subsonicLibrary';
import type { SubsonicShare } from '@/lib/api/subsonicSharing';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { formatTrackTime } from '@/lib/format/formatDuration';
import {
  shareEntryAsSong,
  shareEntryIsAlbum,
  shareResourceSummary,
} from '@/features/share/sharePresentation';
import Modal from '@/ui/Modal';

interface ShareContentsModalProps {
  open: boolean;
  onClose: () => void;
  serverId: string;
  share: SubsonicShare;
}

interface ContentsState {
  loading: boolean;
  songs: SubsonicSong[];
  failedEntries: number;
}

async function loadEntrySongs(serverId: string, share: SubsonicShare): Promise<ContentsState> {
  const results = await Promise.all((share.entry ?? []).map(async entry => {
    if (shareEntryIsAlbum(entry) && typeof entry.id === 'string') {
      try {
        const album = await getAlbumForServer(serverId, entry.id, { mirrorToIndex: false });
        return { songs: album.songs, failed: false };
      } catch {
        return { songs: [], failed: true };
      }
    }
    const song = shareEntryAsSong(entry);
    return { songs: song ? [song] : [], failed: song === null };
  }));
  const seen = new Set<string>();
  const songs = results.flatMap(result => result.songs).filter(song => {
    if (seen.has(song.id)) return false;
    seen.add(song.id);
    return true;
  });
  return {
    loading: false,
    songs,
    failedEntries: results.filter(result => result.failed).length,
  };
}

export default function ShareContentsModal({
  open,
  onClose,
  serverId,
  share,
}: ShareContentsModalProps) {
  const { t } = useTranslation();
  const [contents, setContents] = useState<ContentsState>({ loading: true, songs: [], failedEntries: 0 });

  useEffect(() => {
    if (!open) return;
    let active = true;
    void loadEntrySongs(serverId, share).then(next => {
      if (active) setContents(next);
    });
    return () => {
      active = false;
    };
  }, [open, serverId, share]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={share.description || t('shared.contentsTitle')}
      subtitle={shareResourceSummary(share, t)}
      icon={<ListMusic size={16} aria-hidden="true" />}
      size="lg"
      closeLabel={t('common.close')}
    >
      <div className="shared-contents-modal">
        {contents.loading && <div className="shared-contents-modal__state">{t('common.loading')}</div>}
        {!contents.loading && contents.failedEntries > 0 && (
          <div className="shared-contents-modal__warning" role="alert">{t('shared.contentsLoadFailed')}</div>
        )}
        {!contents.loading && contents.songs.length === 0 && (
          <div className="shared-contents-modal__state">{t('shared.contentsEmpty')}</div>
        )}
        {!contents.loading && contents.songs.length > 0 && (
          <ol className="shared-contents-modal__list">
            {contents.songs.map((song, index) => (
              <li className="shared-contents-modal__track" key={song.id}>
                {song.coverArt || song.albumId ? (
                  <AlbumCoverArtImage
                    albumId={song.albumId || song.id}
                    coverArt={song.coverArt}
                    serverScope={coverServerScopeForServerId(serverId)}
                    displayCssPx={48}
                    surface="dense"
                    className="shared-contents-modal__cover"
                    alt=""
                  />
                ) : (
                  <span className="shared-contents-modal__fallback" aria-hidden="true"><Music size={16} /></span>
                )}
                <span className="shared-contents-modal__number">{song.track ?? index + 1}</span>
                <span className="shared-contents-modal__meta">
                  <strong>{song.title}</strong>
                  <span>{[song.artist, song.album].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="shared-contents-modal__duration">{formatTrackTime(song.duration)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Modal>
  );
}
