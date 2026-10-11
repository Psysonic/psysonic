import type { SubsonicOpenArtistRef } from '@/lib/api/subsonicTypes';
import type { Track } from '@/lib/media/trackTypes';

export interface MiniTrackInfo {
  id: string;
  title: string;
  artist: string;
  /** OpenSubsonic performer refs when the main queue carried them. */
  artists?: SubsonicOpenArtistRef[];
  album: string;
  albumId?: string;
  artistId?: string;
  /** Owning server profile id for detail navigation and mutations. */
  serverId?: string;
  coverArt?: string;
  duration?: number;
  starred?: boolean;
  year?: number;
  /** OpenSubsonic `explicitStatus`, for the badge and the cover blur. */
  explicitStatus?: string;
}

export function toMini(t: Track): MiniTrackInfo {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    artists: Array.isArray(t.artists) && t.artists.length > 0 ? t.artists : undefined,
    album: t.album,
    albumId: t.albumId,
    artistId: t.artistId,
    serverId: t.serverId,
    coverArt: t.coverArt,
    duration: t.duration,
    starred: !!t.starred,
    year: t.year,
    explicitStatus: t.explicitStatus,
  };
}
