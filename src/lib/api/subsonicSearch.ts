import {
  api,
  apiForServer,
  libraryFilterParams,
  libraryFilterParamsForServer,
} from '@/lib/api/subsonicClient';
import { searchQueryIsFtsSafe } from '@/lib/library/searchQueryFtsSafe';
import { resolveIndexKey } from '@/lib/server/serverIndexKey';
import type {
  SearchResults,
  SubsonicAlbum,
  SubsonicArtist,
  SubsonicSong,
} from '@/lib/api/subsonicTypes';

/**
 * search3 sometimes returns duplicate or junk artist rows with **zero** albums (e.g. Navidrome indexing).
 * Keep catalog-provider rows (`isExternal` present): their local album count
 * does not establish whether the artist can be browsed through the provider.
 * Otherwise drop explicit zero counts and keep artists when the count is absent.
 * Thanks to zunoz for the report on the Psysonic Discord.
 */
export function filterSearchArtistsWithNoAlbums(artists: SubsonicArtist[]): SubsonicArtist[] {
  return artists.filter((a) => a.isExternal !== undefined || a.albumCount !== 0);
}

export async function search(
  query: string,
  options?: {
    albumCount?: number;
    artistCount?: number;
    songCount?: number;
    signal?: AbortSignal;
    timeout?: number;
  },
): Promise<SearchResults> {
  if (!query.trim()) return { artists: [], albums: [], songs: [] };
  if (!searchQueryIsFtsSafe(query)) return { artists: [], albums: [], songs: [] };
  const data = await api<{
    searchResult3: {
      artist?: SubsonicArtist[];
      album?: SubsonicAlbum[];
      song?: SubsonicSong[];
    };
  }>(
    'search3.view',
    {
      query,
      artistCount: options?.artistCount ?? 5,
      albumCount: options?.albumCount ?? 5,
      songCount: options?.songCount ?? 10,
      ...libraryFilterParams(),
    },
    options?.timeout ?? 15000,
    options?.signal,
  );
  const r = data.searchResult3 ?? {};
  return {
    artists: filterSearchArtistsWithNoAlbums(r.artist ?? []),
    albums: r.album ?? [],
    songs: r.song ?? [],
  };
}

export async function searchForServer(
  serverId: string,
  query: string,
  options?: {
    albumCount?: number;
    artistCount?: number;
    songCount?: number;
    timeout?: number;
  },
): Promise<SearchResults> {
  if (!query.trim() || !searchQueryIsFtsSafe(query)) {
    return { artists: [], albums: [], songs: [] };
  }
  const data = await apiForServer<{
    searchResult3: {
      artist?: SubsonicArtist[];
      album?: SubsonicAlbum[];
      song?: SubsonicSong[];
    };
  }>(serverId, 'search3.view', {
    query,
    artistCount: options?.artistCount ?? 5,
    albumCount: options?.albumCount ?? 5,
    songCount: options?.songCount ?? 10,
    ...libraryFilterParamsForServer(serverId),
  }, options?.timeout ?? 15000);
  const r = data.searchResult3 ?? {};
  const ownerServerKey = resolveIndexKey(serverId);
  return {
    artists: filterSearchArtistsWithNoAlbums(r.artist ?? []).map(artist => ({ ...artist, serverId: ownerServerKey })),
    albums: (r.album ?? []).map(album => ({ ...album, serverId: ownerServerKey })),
    songs: (r.song ?? []).map(song => ({ ...song, serverId: ownerServerKey })),
  };
}

export async function searchSongsPagedForServer(
  serverId: string,
  query: string,
  songCount: number,
  songOffset: number,
): Promise<SubsonicSong[]> {
  const q = query.trim();
  if (q && !searchQueryIsFtsSafe(q)) return [];
  const data = await apiForServer<{ searchResult3: { song?: SubsonicSong[] } }>(
    serverId,
    'search3.view',
    {
      query,
      artistCount: 0,
      albumCount: 0,
      songCount,
      songOffset,
      ...libraryFilterParamsForServer(serverId),
    },
  );
  const ownerServerKey = resolveIndexKey(serverId);
  return (data.searchResult3?.song ?? []).map(song => ({ ...song, serverId: ownerServerKey }));
}

/**
 * Song-only paginated search3. Tolerates empty query — Navidrome returns all songs
 * ordered by title in that case; strict Subsonic implementations may return nothing.
 * Caller handles empty results gracefully (Tracks page falls back to its random pool).
 */
export async function searchSongsPaged(query: string, songCount: number, songOffset: number): Promise<SubsonicSong[]> {
  const q = query.trim();
  if (q && !searchQueryIsFtsSafe(q)) return [];
  const data = await api<{ searchResult3: { song?: SubsonicSong[] } }>('search3.view', {
    query,
    artistCount: 0,
    albumCount: 0,
    songCount,
    songOffset,
    ...libraryFilterParams(),
  });
  return data.searchResult3?.song ?? [];
}
