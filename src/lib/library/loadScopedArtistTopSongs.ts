import { getTopSongsForServer } from '@/lib/api/subsonicArtists';
import { libraryGetTracksBatch } from '@/lib/api/library/reads';
import type { LibraryScopePair } from '@/lib/api/library/scopeReads';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';

const DISPLAY_LIMIT = 5;
const REQUEST_COUNT = 20;
const NETWORK_TIMEOUT_MS = 5000;
const BATCH_VALIDATION_TIMEOUT_MS = 2000;

interface CachedTopSongs {
  tracksFingerprint: string;
  songs: SubsonicSong[];
}

export interface LoadScopedArtistTopSongsOptions {
  artistName: string;
  sourceServerId: string;
  scopes: LibraryScopePair[];
  localFallback: SubsonicSong[];
  tracksFingerprint: string;
}

const topSongsCache = new Map<string, CachedTopSongs>();
const topSongsInFlight = new Map<string, Promise<SubsonicSong[]>>();

function scopeKey(options: LoadScopedArtistTopSongsOptions): string {
  const libraries = options.scopes
    .filter(scope => scope.serverId === options.sourceServerId)
    .map(scope => scope.libraryId)
    .join(',');
  return `${options.sourceServerId}\u0000${libraries}\u0000${options.artistName.trim().toLocaleLowerCase()}`;
}

function requestKey(options: LoadScopedArtistTopSongsOptions): string {
  return `${scopeKey(options)}\u0000${options.tracksFingerprint}`;
}

function songIdentity(song: SubsonicSong): string {
  const rawIsrc: unknown = song.isrc;
  const isrcValue = Array.isArray(rawIsrc)
    ? rawIsrc.find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : typeof rawIsrc === 'string' ? rawIsrc : undefined;
  const isrc = isrcValue?.trim().toLocaleLowerCase();
  if (isrc) return `isrc:${isrc}`;
  const normalize = (value: string | undefined) => value?.trim().toLocaleLowerCase() ?? '';
  return [normalize(song.title), normalize(song.album), Math.round((song.duration ?? 0) / 5)].join('\u0000');
}

function mergeWithFallback(networkSongs: SubsonicSong[], localFallback: SubsonicSong[]): SubsonicSong[] {
  const merged: SubsonicSong[] = [];
  const seen = new Set<string>();
  for (const song of [...networkSongs, ...localFallback]) {
    const identity = songIdentity(song);
    if (seen.has(identity)) continue;
    seen.add(identity);
    merged.push(song);
    if (merged.length === DISPLAY_LIMIT) break;
  }
  return merged;
}

async function fetchScopedTopSongs(
  options: LoadScopedArtistTopSongsOptions,
): Promise<SubsonicSong[]> {
  const serverScopes = options.scopes.filter(scope => scope.serverId === options.sourceServerId);
  if (serverScopes.length === 0) return [];
  // A null library id is the whole server ("all libraries"): ask without a folder filter
  // and accept any indexed track of that server.
  const wholeServer = serverScopes.some(scope => scope.libraryId === null);
  const libraryIds = wholeServer
    ? []
    : serverScopes.flatMap(scope => scope.libraryId === null ? [] : [scope.libraryId]);

  const candidates = await getTopSongsForServer(options.sourceServerId, options.artistName, {
    requestCount: REQUEST_COUNT,
    limit: REQUEST_COUNT,
    timeout: NETWORK_TIMEOUT_MS,
    libraryIds,
    filterToLibrary: false,
  });
  if (candidates.length === 0) return [];

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let indexed: Awaited<ReturnType<typeof libraryGetTracksBatch>>;
  try {
    indexed = await Promise.race([
      libraryGetTracksBatch(candidates.map(song => ({
        serverId: options.sourceServerId,
        trackId: song.id,
      }))),
      new Promise<Awaited<ReturnType<typeof libraryGetTracksBatch>>>(resolve => {
        timeoutId = setTimeout(() => resolve([]), BATCH_VALIDATION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
  const allowedLibraries = new Set(libraryIds);
  const allowedTrackIds = new Set(
    indexed
      .filter(track => wholeServer || (!!track.libraryId && allowedLibraries.has(track.libraryId)))
      .map(track => track.id),
  );
  return candidates
    .filter(song => allowedTrackIds.has(song.id))
    .map(song => ({ ...song, serverId: options.sourceServerId }));
}

/**
 * Load one server's global Top Songs ranking without blocking artist metadata.
 * The local index validates browse scope and supplies a deterministic fallback.
 */
export async function loadScopedArtistTopSongs(
  options: LoadScopedArtistTopSongsOptions,
): Promise<SubsonicSong[]> {
  const key = scopeKey(options);
  const cached = topSongsCache.get(key);
  if (cached?.tracksFingerprint === options.tracksFingerprint) {
    return mergeWithFallback(cached.songs, options.localFallback);
  }
  topSongsCache.delete(key);

  const inFlightKey = requestKey(options);
  let request = topSongsInFlight.get(inFlightKey);
  if (!request) {
    request = fetchScopedTopSongs(options)
      .catch(() => [])
      .then(songs => {
        if (songs.length > 0) {
          topSongsCache.set(key, { tracksFingerprint: options.tracksFingerprint, songs });
        }
        return songs;
      })
      .finally(() => topSongsInFlight.delete(inFlightKey));
    topSongsInFlight.set(inFlightKey, request);
  }
  return mergeWithFallback(await request, options.localFallback);
}
