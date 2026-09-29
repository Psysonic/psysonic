import { libraryListAlbumsByMood } from '@/lib/api/library';
import {
  libraryScopeForServer,
  libraryScopePairsForServer,
} from '@/lib/api/subsonicClient';
import { albumToAlbum } from './advancedSearchLocal';
import {
  albumSortClauses,
  type AlbumBrowseSort,
} from './albumBrowseSort';
import type { AlbumBrowsePageResult } from './albumBrowseTypes';
import type { LibraryBrowseScope } from './libraryBrowseScope';
import { readyLibraryServerKeys } from './libraryReady';

export const MOOD_ALBUM_FIRST_PAGE = 60;
export const MOOD_ALBUM_CATALOG_CHUNK = 200;

const localPageInflight = new Map<
  string,
  Promise<AlbumBrowsePageResult | null>
>();

async function fetchLocalMoodAlbumPage(
  serverId: string,
  mood: string,
  offset: number,
  pageSize: number,
  sort: AlbumBrowseSort,
  browseScope?: LibraryBrowseScope,
): Promise<AlbumBrowsePageResult | null> {
  const scope = browseScope
    ? undefined
    : libraryScopeForServer(serverId) ?? undefined;

  const libraryScopes = browseScope?.pairs.length
    ? browseScope.pairs
    : libraryScopePairsForServer(serverId);

  const serverIds = browseScope?.serverIds.length
    ? browseScope.serverIds
    : [serverId];

  if (!(await readyLibraryServerKeys(serverIds))) {
    return null;
  }

  const requestKey = JSON.stringify({
    serverId,
    mood,
    offset,
    pageSize,
    sort,
    scope,
    libraryScopes,
  });

  const existing = localPageInflight.get(requestKey);

  if (existing) {
    return existing;
  }

  const request =
    (async (): Promise<AlbumBrowsePageResult | null> => {
      try {
        const resp = await libraryListAlbumsByMood({
          serverId,
          mood,
          libraryScope: scope,
          libraryScopes,
          sort: albumSortClauses(sort),
          limit: pageSize,
          offset,
        });

        if (resp.source !== 'local') {
          return null;
        }

        return {
          albums: resp.albums.map(albumToAlbum),
          hasMore: resp.hasMore,
        };
      } catch {
        return null;
      }
    })();

  localPageInflight.set(requestKey, request);

  try {
    return await request;
  } finally {
    if (localPageInflight.get(requestKey) === request) {
      localPageInflight.delete(requestKey);
    }
  }
}

/**
 * Album grid for one file mood.
 *
 * File moods are a local-index feature, so unlike genre browsing there is no
 * Subsonic network fallback.
 */
export async function fetchMoodAlbumPage(
  serverId: string,
  mood: string,
  indexEnabled: boolean,
  offset: number,
  pageSize: number,
  sort: AlbumBrowseSort,
  browseScope?: LibraryBrowseScope,
): Promise<AlbumBrowsePageResult> {
  if (!serverId || !mood.trim() || !indexEnabled) {
    return {
      albums: [],
      hasMore: false,
    };
  }

  const local = await fetchLocalMoodAlbumPage(
    serverId,
    mood,
    offset,
    pageSize,
    sort,
    browseScope,
  );

  return (
    local ?? {
      albums: [],
      hasMore: false,
    }
  );
}

export async function fetchMoodAlbumTotal(
  serverId: string,
  mood: string,
  indexEnabled: boolean,
  sort: AlbumBrowseSort,
  browseScope?: LibraryBrowseScope,
): Promise<number | null> {
  if (!mood.trim() || !indexEnabled || !serverId) {
    return null;
  }

  const serverIds = browseScope?.serverIds.length
    ? browseScope.serverIds
    : [serverId];

  if (!(await readyLibraryServerKeys(serverIds))) {
    return null;
  }

  const scope = browseScope
    ? undefined
    : libraryScopeForServer(serverId) ?? undefined;

  const libraryScopes = browseScope?.pairs.length
    ? browseScope.pairs
    : libraryScopePairsForServer(serverId);

  try {
    const resp = await libraryListAlbumsByMood({
      serverId,
      mood,
      libraryScope: scope,
      libraryScopes,
      sort: albumSortClauses(sort),
      limit: 1,
      offset: 0,
      includeTotal: true,
      countOnly: true,
    });

    if (resp.source === 'local' && resp.total != null) {
      return resp.total;
    }
  } catch {
    return null;
  }

  return null;
}