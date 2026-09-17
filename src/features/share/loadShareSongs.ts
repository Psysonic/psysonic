import { getAlbumForServer } from '@/lib/api/subsonicLibrary';
import type { SubsonicShare } from '@/lib/api/subsonicSharing';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { shareEntryAsSong, shareEntryIsAlbum } from '@/features/share/sharePresentation';

export interface LoadedShareSongs {
  songs: SubsonicSong[];
  failedEntries: number;
}

const SHARE_ALBUM_LOAD_CONCURRENCY = 4;

export async function loadShareSongs(serverId: string, share: SubsonicShare): Promise<LoadedShareSongs> {
  const entries = share.entry ?? [];
  const results: Array<{ songs: SubsonicSong[]; failed: boolean }> = new Array(entries.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      const entry = entries[index];
      if (!entry) return;
      if (shareEntryIsAlbum(entry) && typeof entry.id === 'string') {
        try {
          const album = await getAlbumForServer(serverId, entry.id, { mirrorToIndex: false });
          results[index] = {
            songs: album.songs.map(song => ({ ...song, serverId: song.serverId ?? serverId })),
            failed: false,
          };
        } catch {
          results[index] = { songs: [], failed: true };
        }
      } else {
        const song = shareEntryAsSong(entry, serverId);
        results[index] = { songs: song ? [song] : [], failed: song === null };
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(SHARE_ALBUM_LOAD_CONCURRENCY, entries.length) },
    worker,
  ));
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
