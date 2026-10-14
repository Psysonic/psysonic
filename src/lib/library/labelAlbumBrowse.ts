import { libraryListAlbumsByLabel } from '@/lib/api/library';
import { search } from '@/lib/api/subsonicSearch';
import { libraryScopeForServer, libraryScopePairsForServer } from '@/lib/api/subsonicClient';
import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';
import { albumToAlbum } from './advancedSearchLocal';
import { albumSortClauses, sortSubsonicAlbums, type AlbumBrowseSort } from './albumBrowseSort';
import type { AlbumBrowsePageResult } from './albumBrowseTypes';
import type { LibraryBrowseScope } from './libraryBrowseScope';
import { readyLibraryServerKeys } from './libraryReady';

/** First paint — one visible slice only. */
export const LABEL_ALBUM_FIRST_PAGE = 60;
/** Background SQL chunk when the in-memory buffer is exhausted. */
export const LABEL_ALBUM_CATALOG_CHUNK = 200;
/** Albums asked from `search3` while the local index is still being built. */
const NETWORK_FALLBACK_ALBUMS = 200;

const localPageInflight = new Map<string, Promise<AlbumBrowsePageResult | null>>();

function localScopeArgs(serverId: string, browseScope?: LibraryBrowseScope) {
  return {
    serverIds: browseScope?.serverIds.length ? browseScope.serverIds : [serverId],
    libraryScope: browseScope ? undefined : libraryScopeForServer(serverId) ?? undefined,
    libraryScopes: browseScope?.pairs.length
      ? browseScope.pairs
      : libraryScopePairsForServer(serverId),
  };
}

async function fetchLocalLabelAlbumPage(
  serverId: string,
  label: string,
  offset: number,
  pageSize: number,
  sort: AlbumBrowseSort,
  browseScope?: LibraryBrowseScope,
): Promise<AlbumBrowsePageResult | null> {
  const { serverIds, libraryScope, libraryScopes } = localScopeArgs(serverId, browseScope);
  if (!(await readyLibraryServerKeys(serverIds))) return null;
  const requestKey = JSON.stringify({ serverId, label, offset, pageSize, sort, libraryScope, libraryScopes });
  const existing = localPageInflight.get(requestKey);
  if (existing) return existing;

  const request = (async (): Promise<AlbumBrowsePageResult | null> => {
    try {
      const resp = await libraryListAlbumsByLabel({
        serverId,
        label,
        libraryScope,
        libraryScopes,
        sort: albumSortClauses(sort),
        limit: pageSize,
        offset,
      });
      if (resp.source !== 'local') return null;
      return { albums: resp.albums.map(albumToAlbum), hasMore: resp.hasMore };
    } catch {
      return null;
    }
  })();
  localPageInflight.set(requestKey, request);
  try {
    return await request;
  } finally {
    if (localPageInflight.get(requestKey) === request) localPageInflight.delete(requestKey);
  }
}

/** Search hits whose record label matches exactly, else every album hit. */
export function albumsMatchingLabel(albums: readonly SubsonicAlbum[], label: string): SubsonicAlbum[] {
  const wanted = label.trim().toLocaleLowerCase();
  const matches = albums.filter(a => a.recordLabel?.trim().toLocaleLowerCase() === wanted);
  return matches.length > 0 ? matches : [...albums];
}

/**
 * Before the local index is ready there is no label projection to page
 * through, so fall back to one `search3` page on the label name — the
 * behaviour the label page had before labels were indexed.
 */
async function fetchNetworkLabelAlbumPage(
  label: string,
  offset: number,
  sort: AlbumBrowseSort,
): Promise<AlbumBrowsePageResult> {
  if (offset > 0) return { albums: [], hasMore: false };
  try {
    const res = await search(label, { albumCount: NETWORK_FALLBACK_ALBUMS, artistCount: 0, songCount: 0 });
    return { albums: sortSubsonicAlbums(albumsMatchingLabel(res.albums, label), sort), hasMore: false };
  } catch {
    return { albums: [], hasMore: false };
  }
}

/** Album grid for label detail — local index when ready, else a name search. */
export async function fetchLabelAlbumPage(
  serverId: string,
  label: string,
  indexEnabled: boolean,
  offset: number,
  pageSize: number,
  sort: AlbumBrowseSort,
  browseScope?: LibraryBrowseScope,
): Promise<AlbumBrowsePageResult> {
  if (!serverId || !label.trim()) return { albums: [], hasMore: false };
  if (indexEnabled) {
    const local = await fetchLocalLabelAlbumPage(serverId, label, offset, pageSize, sort, browseScope);
    if (local != null) return local;
  }
  return fetchNetworkLabelAlbumPage(label, offset, sort);
}

/** Distinct albums for one label in the browse scope; null until the index is ready. */
export async function fetchLabelAlbumTotal(
  serverId: string,
  label: string,
  indexEnabled: boolean,
  sort: AlbumBrowseSort,
  browseScope?: LibraryBrowseScope,
): Promise<number | null> {
  if (!label.trim() || !indexEnabled || !serverId) return null;
  const { serverIds, libraryScope, libraryScopes } = localScopeArgs(serverId, browseScope);
  if (!(await readyLibraryServerKeys(serverIds))) return null;
  try {
    const resp = await libraryListAlbumsByLabel({
      serverId,
      label,
      libraryScope,
      libraryScopes,
      sort: albumSortClauses(sort),
      limit: 1,
      offset: 0,
      includeTotal: true,
      countOnly: true,
    });
    return resp.source === 'local' && resp.total != null ? resp.total : null;
  } catch {
    return null;
  }
}
