import { getAlbumList } from '@/lib/api/subsonicLibrary';
import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';
import { deriveLibraryBrowseScope } from '@/lib/library/libraryBrowseScope';
import { loadLocalNewReleases } from '@/lib/library/newReleasesLocal';
import { useAuthStore } from '@/store/authStore';

/** How far back the export looks: the newest albums, newest first. */
const NEWEST_LIMIT = 500;
const INDEX_PAGE = 100;

/**
 * The New Releases feed from the local index — the same list, merge and
 * representative the New Releases page shows. A release the server splits into
 * several albums (per-track album-artist tags) therefore appears once.
 */
async function loadNewestFromIndex(): Promise<SubsonicAlbum[]> {
  const { anchorServerId, pairs } = deriveLibraryBrowseScope(useAuthStore.getState());
  if (!anchorServerId || pairs.length === 0) return [];
  const albums: SubsonicAlbum[] = [];
  for (let offset = 0; offset < NEWEST_LIMIT; offset += INDEX_PAGE) {
    const page = await loadLocalNewReleases(anchorServerId, pairs, INDEX_PAGE, offset);
    albums.push(...page.albums);
    if (!page.hasMore) break;
  }
  return albums;
}

/**
 * One read per dialog session; the date filter then runs locally. Index first;
 * the server list only when the index has nothing yet (first sync still running).
 */
export async function loadNewestAlbums(): Promise<SubsonicAlbum[]> {
  try {
    const local = await loadNewestFromIndex();
    if (local.length > 0) return local;
  } catch (err) {
    console.warn('[album export] index read failed, using the server list:', err);
  }
  return getAlbumList('newest', NEWEST_LIMIT);
}

/** Albums added on or after `since` (ms), sorted by artist, then title. `since <= 0` keeps all. */
export function albumsAddedSince(albums: readonly SubsonicAlbum[], since: number): SubsonicAlbum[] {
  const picked = since > 0
    ? albums.filter(a => a.created && new Date(a.created).getTime() >= since)
    : [...albums];
  return picked.sort((a, b) => a.artist.localeCompare(b.artist, 'de') || a.name.localeCompare(b.name, 'de'));
}
