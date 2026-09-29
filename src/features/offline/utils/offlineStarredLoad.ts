import { getStarredForServer } from '@/lib/api/subsonicStarRating';
import {
  libraryAdvancedSearch,
  libraryListStarred,
  libraryReconcileArtistStars,
} from '@/lib/api/library';
import type {
  StarredResults,
  SubsonicAlbum,
  SubsonicArtist,
  SubsonicSong,
} from '@/lib/api/subsonicTypes';
import { isActiveServerReachable } from '@/lib/network/activeServerReachability';
import { emitFavoritesBrowseDebug, favoritesBrowseTimed } from '@/lib/library/favoritesBrowseDebug';
import {
  albumToAlbum,
  artistToArtist,
  trackToSong,
} from '@/lib/library/advancedSearchLocal';
import { dedupeById } from '@/lib/util/dedupeById';
import { isOfflineBrowseActive } from '@/features/offline/utils/offlineBrowseMode';
import { favoritesServerIds } from '@/features/offline/utils/favoritesOfflineBrowse';
import {
  buildAlbumFromTracks,
  fetchBrowsableLocalTrackDtos,
  fetchOfflineLocalStarredArtists,
  offlineLocalBrowseEnabled,
} from '@/features/offline/utils/offlineLocalBrowse';

function tagStarredWithServer(starred: StarredResults, serverId: string): StarredResults {
  const withServer = <T extends { id: string }>(items: T[]): (T & { serverId: string })[] =>
    items.map(item => ({ ...item, serverId }));

  return {
    artists: withServer(starred.artists),
    albums: withServer(starred.albums),
    songs: withServer(starred.songs),
  };
}

/** Merge starred lists from multiple servers; dedupe by `serverId:id`. */
export function mergeStarredFromServers(
  entries: { serverId: string; starred: StarredResults }[],
): StarredResults {
  const artists: SubsonicArtist[] = [];
  const albums: SubsonicAlbum[] = [];
  const songs: SubsonicSong[] = [];
  for (const { serverId, starred } of entries) {
    const tagged = tagStarredWithServer(starred, serverId);
    artists.push(...tagged.artists);
    albums.push(...tagged.albums);
    songs.push(...tagged.songs);
  }
  return {
    artists: dedupeById(artists),
    albums: dedupeById(albums),
    songs: dedupeById(songs),
  };
}

/**
 * Offline favorites: start from on-disk bytes, then keep starred tracks/albums only.
 * Avoids scanning the full starred catalog in SQL when only a local subset is playable.
 */
async function loadStarredFromBrowsableLocalBytes(serverId: string): Promise<StarredResults> {
  const allLocal = await fetchBrowsableLocalTrackDtos(serverId);
  if (allLocal.length === 0) {
    return { artists: [], albums: [], songs: [] };
  }

  const starredTracks = allLocal.filter(t => t.starredAt != null);
  const songs = starredTracks
    .map(trackToSong)
    .map(s => ({ ...s, serverId }));

  const albumsById = new Map<string, SubsonicAlbum>();
  const byStarredAlbum = new Map<string, typeof allLocal>();
  for (const track of starredTracks) {
    if (!track.albumId) continue;
    const list = byStarredAlbum.get(track.albumId) ?? [];
    list.push(track);
    byStarredAlbum.set(track.albumId, list);
  }
  for (const [albumId, albumTracks] of byStarredAlbum) {
    albumsById.set(albumId, buildAlbumFromTracks(albumId, albumTracks, serverId));
  }

  const localAlbumIds = [...new Set(
    allLocal.map(t => t.albumId).filter((id): id is string => !!id),
  )];
  if (localAlbumIds.length > 0) {
    const albumSearch = await libraryAdvancedSearch({
      serverId,
      entityTypes: ['album'],
      starredOnly: true,
      restrictAlbumIds: localAlbumIds,
      limit: localAlbumIds.length,
      skipTotals: true,
    });
    for (const dto of albumSearch.albums) {
      albumsById.set(dto.id, { ...albumToAlbum(dto), serverId });
    }
  }
  const artists = await fetchOfflineLocalStarredArtists(serverId, 'album') ?? [];

  return {
    artists,
    albums: [...albumsById.values()],
    songs,
  };
}

export async function loadStarredFromLibraryIndex(
  serverId: string,
  preferLocalBytes = false,
): Promise<StarredResults> {
  if (preferLocalBytes && offlineLocalBrowseEnabled(serverId)) {
    return loadStarredFromBrowsableLocalBytes(serverId);
  }

  const response = await libraryListStarred(serverId);
  emitFavoritesBrowseDebug('library_index_native_read', {
    serverId,
    readLockWaitMs: response.readLockWaitMs,
    sqlMs: response.sqlMs,
    blockedBy: response.blockedBy,
  });
  return {
    artists: response.artists.map(artistToArtist),
    albums: response.albums.map(albumToAlbum),
    songs: response.tracks.map(trackToSong),
  };
}

const libraryIndexLoads = new Map<string, Promise<StarredResults>>();

export async function loadStarredFromAllLibraryIndexes(
  preferLocalBytes = isOfflineBrowseActive(),
  serverIds = favoritesServerIds(),
): Promise<StarredResults> {
  const cacheKey = `${preferLocalBytes}:${serverIds.join('\u001f')}`;
  const inFlight = libraryIndexLoads.get(cacheKey);
  if (inFlight) return inFlight;

  const load = Promise.all(
    serverIds.map(async serverId => {
      try {
        const starred = await favoritesBrowseTimed(
          'library_index_server',
          () => loadStarredFromLibraryIndex(serverId, preferLocalBytes),
          { serverId, preferLocalBytes },
        );
        return { serverId, starred };
      } catch {
        return { serverId, starred: { artists: [], albums: [], songs: [] } satisfies StarredResults };
      }
    }),
  ).then(mergeStarredFromServers);
  libraryIndexLoads.set(cacheKey, load);
  void load.finally(() => {
    if (libraryIndexLoads.get(cacheKey) === load) libraryIndexLoads.delete(cacheKey);
  });
  return load;
}

/** Online starred merge with per-server local index fallback. */
export async function loadStarredFromAllServersOnline(
  serverIds = favoritesServerIds(),
): Promise<StarredResults> {
  if (!isActiveServerReachable()) {
    return loadStarredFromAllLibraryIndexes(false, serverIds);
  }
  const entries = await Promise.all(
    serverIds.map(async serverId => {
      try {
        const starred = await getStarredForServer(serverId);
        await libraryReconcileArtistStars({
          serverId,
          starredArtists: starred.artists.map(artist => {
            const parsed = artist.starred ? Date.parse(artist.starred) : Number.NaN;
            return {
              id: artist.id,
              starredAt: Number.isFinite(parsed) ? parsed : Date.now(),
            };
          }),
        }).catch(() => {});
        return { serverId, starred };
      } catch {
        try {
          const starred = await loadStarredFromLibraryIndex(serverId);
          return { serverId, starred };
        } catch {
          return { serverId, starred: { artists: [], albums: [], songs: [] } satisfies StarredResults };
        }
      }
    }),
  );
  return mergeStarredFromServers(entries);
}
