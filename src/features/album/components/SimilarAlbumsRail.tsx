import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { useTranslation } from 'react-i18next';
import AlbumRow from '@/features/album/components/AlbumRow';
import { useAlbumSimilarAlbums } from '@/features/album/hooks/useAlbumSimilarAlbums';

interface Props {
  serverId: string;
  albumId: string;
  artistId?: string;
  songs: readonly SubsonicSong[];
  enabled: boolean;
}

/** AudioMuse "Similar albums" rail below the album tracklist; renders nothing until it has albums. */
export default function SimilarAlbumsRail({ serverId, albumId, artistId, songs, enabled }: Props) {
  const { t } = useTranslation();
  const { albums } = useAlbumSimilarAlbums({ serverId, albumId, artistId, songs, enabled });
  if (albums.length === 0) return null;
  return (
    <div className="album-related">
      <div className="album-related-divider" />
      <AlbumRow title={t('albumDetail.similarAlbums')} albums={albums} />
    </div>
  );
}
