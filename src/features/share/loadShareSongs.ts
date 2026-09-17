import { getAlbumForServer } from '@/lib/api/subsonicLibrary';
import type { SubsonicShare } from '@/lib/api/subsonicSharing';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { shareEntryAsSong, shareEntryIsAlbum } from '@/features/share/sharePresentation';

export interface LoadedShareSongs {
  songs: SubsonicSong[];
  failedEntries: number;
}

export async function loadShareSongs(serverId: string, share: SubsonicShare): Promise<LoadedShareSongs> {
  const results = await Promise.all((share.entry ?? []).map(async entry => {
    if (shareEntryIsAlbum(entry) && typeof entry.id === 'string') {
      try {
        const album = await getAlbumForServer(serverId, entry.id, { mirrorToIndex: false });
        return {
          songs: album.songs.map(song => ({ ...song, serverId: song.serverId ?? serverId })),
          failed: false,
        };
      } catch {
        return { songs: [], failed: true };
      }
    }
    const song = shareEntryAsSong(entry, serverId);
    return { songs: song ? [song] : [], failed: song === null };
  }));
  const seen = new Set<string>();
  const songs = results.flatMap(result => result.songs).filter(song => {
    const key = `${song.serverId ?? serverId}:${song.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    songs,
    failedEntries: results.filter(result => result.failed).length,
  };
}
