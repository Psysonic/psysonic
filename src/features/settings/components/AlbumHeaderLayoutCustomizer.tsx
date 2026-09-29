import { useTranslation } from 'react-i18next';
import { Download, HardDriveDownload, Heart, Highlighter, ListPlus, Share2, Shuffle } from 'lucide-react';
import { useAlbumHeaderLayoutStore, type AlbumHeaderButtonId } from '@/features/album';
import { ActionBarLayoutCustomizer } from '@/features/settings/components/ActionBarLayoutCustomizer';

const ALBUM_HEADER_ICONS: Record<AlbumHeaderButtonId, typeof Shuffle> = {
  shuffle:  Shuffle,
  enqueue:  ListPlus,
  favorite: Heart,
  share:    Share2,
  bio:      Highlighter,
  download: Download,
  offline:  HardDriveDownload,
};

const ALBUM_HEADER_LABEL_KEYS: Record<AlbumHeaderButtonId, string> = {
  shuffle:  'playlists.shuffle',
  enqueue:  'albumDetail.enqueue',
  favorite: 'albumDetail.favoriteAdd',
  share:    'albumDetail.shareAlbum',
  bio:      'albumDetail.artistBio',
  download: 'albumDetail.download',
  offline:  'albumDetail.cacheOffline',
};

export function AlbumHeaderLayoutCustomizer() {
  const { t } = useTranslation();
  const buttons = useAlbumHeaderLayoutStore(s => s.buttons);
  const setButtons = useAlbumHeaderLayoutStore(s => s.setButtons);
  const toggleButton = useAlbumHeaderLayoutStore(s => s.toggleButton);

  const labels = Object.fromEntries(
    Object.entries(ALBUM_HEADER_LABEL_KEYS).map(([id, key]) => [id, t(key)]),
  ) as Record<AlbumHeaderButtonId, string>;

  return (
    <ActionBarLayoutCustomizer
      items={buttons}
      icons={ALBUM_HEADER_ICONS}
      labels={labels}
      reorderType="album_header_reorder"
      onReorder={setButtons}
      onToggle={toggleButton}
    />
  );
}
