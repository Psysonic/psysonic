import { useEffect, useState } from 'react';
import { getMusicNetworkRuntime } from '@/music-network';
import { search, searchForServer } from '@/lib/api/subsonicSearch';
import type { SubsonicArtist, SubsonicArtistInfo } from '@/lib/api/subsonicTypes';
import { useAuthStore } from '@/store/authStore';

export interface ArtistSimilarArtistsResult {
  /** Library artists matched from the Music Network lookup; empty until it has settled. */
  similarArtists: SubsonicArtist[];
  /** True while the lookup for *this* artist is still due or running. */
  similarLoading: boolean;
}

/** One settled or running lookup, bound to the artist and server it was made for. */
interface NetworkLookup {
  artistId: string;
  serverId: string | undefined;
  settled: boolean;
  artists: SubsonicArtist[];
}

/**
 * Resolves the Music Network half of the "Similar Artists" list for the current artist:
 * the primary service's getSimilar → server search for each name → keep first exact match.
 *   - Without AudioMuse the lookup runs whenever a service is set up; the page shows the
 *     server's own list only once it has settled without a match.
 *   - With audiomuseNavidromeEnabled on, the server's list comes first and the lookup only
 *     runs when the server returns nothing.
 * `similarLoading` stays true until the lookup for this artist has settled. The page reads
 * "not loading and empty" as "fall back to the server", so a lookup that has not answered
 * yet — or one still holding the previous artist's result — must never look settled.
 */
export function useArtistSimilarArtists(
  artist: SubsonicArtist | null,
  info: SubsonicArtistInfo | null,
  artistInfoLoading: boolean,
  detailServerId?: string,
): ArtistSimilarArtistsResult {
  const audiomuseNavidromeEnabled = useAuthStore(
    s => !!(detailServerId && s.audiomuseNavidromeByServer[detailServerId]),
  );
  const musicLibraryFilterVersion = useAuthStore(s => s.musicLibraryFilterVersion);
  const enrichmentConfigured = useAuthStore(s => s.enrichmentPrimaryId !== null);

  const serverSimilarCount = info?.similarArtist?.length ?? 0;
  const lookupWanted = !!artist && enrichmentConfigured
    && (!audiomuseNavidromeEnabled || (!artistInfoLoading && serverSimilarCount === 0));

  const [lookup, setLookup] = useState<NetworkLookup | null>(null);

  useEffect(() => {
    if (!lookupWanted || !artist) return;
    let cancelled = false;
    const target = { artistId: artist.id, serverId: detailServerId };
    // React Compiler set-state-in-effect rule: state set from an async result resolved in this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLookup({ ...target, settled: false, artists: [] });
    resolveNetworkSimilarArtists(artist, detailServerId)
      .catch(() => [] as SubsonicArtist[])
      .then(artists => {
        if (!cancelled) setLookup({ ...target, settled: true, artists });
      });
    return () => { cancelled = true; };
    // Keyed on artist?.id / artist?.name; depending on the `artist` object would
    // re-run on every render when its identity changes but its id/name do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupWanted, artist?.id, artist?.name, musicLibraryFilterVersion, detailServerId]);

  const current = lookupWanted && artist
    && lookup?.artistId === artist.id && lookup.serverId === detailServerId
    ? lookup
    : null;
  return {
    similarArtists: current?.settled ? current.artists : [],
    similarLoading: lookupWanted && !current?.settled,
  };
}

async function resolveNetworkSimilarArtists(
  artist: SubsonicArtist,
  detailServerId: string | undefined,
): Promise<SubsonicArtist[]> {
  const names = await getMusicNetworkRuntime().getSimilarArtists(artist.name);
  if (names.length === 0) return [];
  const results = await Promise.all(
    names.slice(0, 30).map(name =>
      (detailServerId
        ? searchForServer(detailServerId, name, { artistCount: 3, albumCount: 0, songCount: 0 })
        : search(name, { artistCount: 3, albumCount: 0, songCount: 0 }))
        .catch(() => ({ artists: [], albums: [], songs: [] }))
    )
  );
  const seen = new Set<string>([artist.id]);
  const found: SubsonicArtist[] = [];
  for (let i = 0; i < results.length; i++) {
    const targetName = names[i].toLowerCase();
    const match = results[i].artists.find(a => a.name.toLowerCase() === targetName);
    if (match && !seen.has(match.id)) {
      seen.add(match.id);
      found.push(match);
    }
  }
  return found;
}
