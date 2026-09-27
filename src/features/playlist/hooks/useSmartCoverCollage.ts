import { useEffect, useState } from 'react';
import { filterSongsToServerLibrary } from '@/lib/api/subsonicLibrary';
import { getPlaylistForServer } from '@/lib/api/subsonicPlaylists';
import type { SubsonicPlaylist } from '@/lib/api/subsonicTypes';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';
import { hasLegacySmartPlaylistName } from '@/lib/format/playlistClassification';

/**
 * Build the 2×2 cover collage for each legacy `psy-smart-` playlist. Pulls each
 * playlist's tracks (filtered to the active library scope) and collects up
 * to four unique cover-art IDs. Re-runs when the playlist list changes or
 * when the active library filter version bumps.
 *
 * Native Navidrome smart playlists are left out on purpose: their server cover
 * may be user-uploaded artwork, and the collage would replace it on the card.
 */
export function useSmartCoverCollage(
  playlists: SubsonicPlaylist[],
  musicLibraryFilterVersion: number,
): Record<string, string[]> {
  const [smartCoverIdsByPlaylist, setSmartCoverIdsByPlaylist] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const smart = playlists.filter(pl => hasLegacySmartPlaylistName(pl.name));
      if (smart.length === 0) {
        if (!cancelled) setSmartCoverIdsByPlaylist({});
        return;
      }
      const rows = await Promise.all(
        smart.map(async (pl) => {
          const key = ownedEntityKey(pl);
          try {
            if (!pl.serverId) return [key, [] as string[]] as const;
            const { songs } = await getPlaylistForServer(pl.serverId, pl.id);
            const filtered = await filterSongsToServerLibrary(songs, pl.serverId);
            const ids: string[] = [];
            const seen = new Set<string>();
            for (const s of filtered) {
              const cid = s.coverArt;
              if (!cid || seen.has(cid)) continue;
              seen.add(cid);
              ids.push(cid);
              if (ids.length >= 4) break;
            }
            return [key, ids] as const;
          } catch {
            return [key, [] as string[]] as const;
          }
        }),
      );
      if (cancelled) return;
      const next: Record<string, string[]> = {};
      for (const [id, ids] of rows) next[id] = ids;
      setSmartCoverIdsByPlaylist(next);
    };
    run();
    return () => { cancelled = true; };
  }, [playlists, musicLibraryFilterVersion]);

  return smartCoverIdsByPlaylist;
}
