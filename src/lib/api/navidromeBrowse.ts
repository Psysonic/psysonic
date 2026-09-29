import type { SubsonicAlbum, SubsonicArtist, SubsonicSong } from '@/lib/api/subsonicTypes';
import { parseItemGenres } from '@/lib/library/genreTags';
import { invoke } from '@tauri-apps/api/core';
import { useAuthStore } from '@/store/authStore';
import { getServerById, librarySelectionForServer } from '@/lib/api/subsonicClient';
import { ndLogin } from '@/lib/api/navidromeAdmin';
import { connectBaseUrlForServer } from '@/lib/server/serverEndpoint';
import { resolveIndexKey } from '@/lib/server/serverIndexKey';

/** Server-keyed Bearer token cache. Cheap to keep — Navidrome tokens are long-lived. */
const cachedTokens = new Map<string, { serverUrl: string; token: string }>();

async function getTokenForServer(serverId: string, force = false): Promise<string> {
  const server = getServerById(serverId);
  if (!server) throw new Error(`Unknown server: ${serverId}`);
  const baseUrl = connectBaseUrlForServer(server);
  const cached = cachedTokens.get(serverId);
  if (!force && cached?.serverUrl === baseUrl) return cached.token;
  const result = await ndLogin(baseUrl, server.username, server.password);
  cachedTokens.set(serverId, { serverUrl: baseUrl, token: result.token });
  return result.token;
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : (typeof v === 'number' ? String(v) : fallback);
}

function currentLibraryIdForServer(serverId: string): string | null {
  const selection = librarySelectionForServer(serverId);
  return selection.length === 1 ? selection[0] : null;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && isFinite(v) ? v : undefined;
}

function mapNdSong(o: Record<string, unknown>): SubsonicSong {
  // Navidrome's REST shape differs from Subsonic — flatten into the SubsonicSong contract.
  const id = asString(o.id ?? o.mediaFileId);
  const albumId = asString(o.albumId);
  return {
    id,
    title: asString(o.title),
    artist: asString(o.artist),
    album: asString(o.album),
    albumId,
    artistId: asString(o.artistId) || undefined,
    duration: asNumber(o.duration) !== undefined ? Math.round(asNumber(o.duration)!) : 0,
    track: asNumber(o.trackNumber),
    discNumber: asNumber(o.discNumber),
    // Navidrome usually exposes coverArtId; many builds also accept the song id directly.
    coverArt: asString(o.coverArtId) || albumId || id || undefined,
    year: asNumber(o.year),
    userRating: asNumber(o.rating),
    starred: o.starred ? asString(o.starredAt) || 'true' : undefined,
    genre: typeof o.genre === 'string' ? o.genre : undefined,
    genres: parseItemGenres(o.genres),
    bitRate: asNumber(o.bitRate),
    suffix: typeof o.suffix === 'string' ? o.suffix : undefined,
    contentType: typeof o.contentType === 'string' ? o.contentType : undefined,
    size: asNumber(o.size),
    samplingRate: asNumber(o.sampleRate),
    bitDepth: asNumber(o.bitDepth),
  };
}

export type NdSongSort = 'title' | 'artist' | 'album' | 'recently_added' | 'play_count' | 'rating' | 'sample_rate' | 'bit_depth';

/** Optional opt-in cache for `ndListSongs` — keyed by call signature + active server. */
type SongsCacheEntry = { data: SubsonicSong[]; expiresAt: number };
const songsCache = new Map<string, SongsCacheEntry>();

function songsCacheKey(
  baseUrl: string, start: number, end: number, sort: string, order: string,
): string {
  return `${baseUrl}|${start}-${end}|${sort}|${order}`;
}

/**
 * Fetch a sorted, paginated slice of all songs via Navidrome's native REST API.
 * Returns mapped SubsonicSong objects. Throws on auth failure or non-Navidrome.
 *
 * `cacheMs` (> 0) opts in to a per-call-signature in-memory cache. Skip for
 * paginated browsing — only useful for stable-list rails (e.g. Highly Rated)
 * where a brief staleness window is acceptable in exchange for skipping the
 * roundtrip on every page revisit.
 */
export async function ndListSongs(
  start: number,
  end: number,
  sort: NdSongSort = 'title',
  order: 'ASC' | 'DESC' = 'ASC',
  cacheMs?: number,
): Promise<SubsonicSong[]> {
  const { activeServerId } = useAuthStore.getState();
  if (!activeServerId) throw new Error('No active server configured');
  return ndListSongsForServer(activeServerId, start, end, sort, order, cacheMs);
}

export async function ndListSongsForServer(
  serverId: string,
  start: number,
  end: number,
  sort: NdSongSort = 'title',
  order: 'ASC' | 'DESC' = 'ASC',
  cacheMs?: number,
): Promise<SubsonicSong[]> {
  const server = getServerById(serverId);
  if (!server) throw new Error(`Unknown server: ${serverId}`);
  const baseUrl = connectBaseUrlForServer(server);

  const cacheKey = (cacheMs && cacheMs > 0)
    ? songsCacheKey(baseUrl, start, end, sort, order)
    : null;
  if (cacheKey) {
    const hit = songsCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.data;
  }

  const callOnce = async (token: string): Promise<unknown> =>
    invoke<unknown>('nd_list_songs', { serverUrl: baseUrl, token, sort, order, start, end });

  let token = await getTokenForServer(serverId);
  let raw: unknown;
  try {
    raw = await callOnce(token);
  } catch (err) {
    const msg = String(err);
    // Token rejected → re-auth once and retry
    if (msg.includes('401') || msg.includes('403')) {
      token = await getTokenForServer(serverId, true);
      raw = await callOnce(token);
    } else {
      throw err;
    }
  }

  if (!Array.isArray(raw)) return [];
  const ownerServerKey = resolveIndexKey(serverId);
  const data = raw.map(s => ({
    ...mapNdSong(s as Record<string, unknown>),
    serverId: ownerServerKey,
  }));

  if (cacheKey && cacheMs && cacheMs > 0) {
    songsCache.set(cacheKey, { data, expiresAt: Date.now() + cacheMs });
  }
  return data;
}

function mapNdArtist(o: Record<string, unknown>, role?: string): SubsonicArtist {
  // Top-level `albumCount` aggregates every role the person holds. The
  // role-scoped count lives in `stats[role].albumCount` (verified empirically
  // 2026-05-06 — Navidrome exposes it as `albumCount`/`songCount`/`size`,
  // not the abbreviated `a`/`s`/… some refactor docs claim).
  const starredFlag = !!o.starred;
  const starredAt = typeof o.starredAt === 'string' ? o.starredAt : undefined;
  let albumCount: number | undefined;
  if (role && o.stats && typeof o.stats === 'object') {
    const roleStats = (o.stats as Record<string, unknown>)[role];
    if (roleStats && typeof roleStats === 'object') {
      albumCount = asNumber((roleStats as Record<string, unknown>).albumCount);
    }
  }
  return {
    id: asString(o.id),
    name: asString(o.name),
    albumCount,
    starred: starredFlag ? (starredAt ?? 'true') : undefined,
    userRating: asNumber(o.rating),
  };
}

function mapNdAlbum(o: Record<string, unknown>): SubsonicAlbum {
  const id = asString(o.id);
  const starredFlag = !!o.starred;
  const starredAt = typeof o.starredAt === 'string' ? o.starredAt : undefined;
  return {
    id,
    name: asString(o.name),
    artist: asString(o.albumArtist) || asString(o.artist),
    artistId: asString(o.albumArtistId) || asString(o.artistId),
    coverArt: asString(o.coverArtId) || asString(o.embedArtPath) || id || undefined,
    songCount: asNumber(o.songCount) ?? 0,
    duration: asNumber(o.duration) ?? 0,
    year: asNumber(o.maxYear) ?? asNumber(o.year),
    genre: typeof o.genre === 'string' ? o.genre : undefined,
    genres: parseItemGenres(o.genres),
    starred: starredFlag ? (starredAt ?? 'true') : undefined,
    userRating: asNumber(o.rating),
    isCompilation: o.compilation === true,
  };
}

export type NdArtistRole = 'composer' | 'conductor' | 'lyricist' | 'arranger'
  | 'producer' | 'director' | 'engineer' | 'mixer' | 'remixer' | 'djmixer'
  | 'performer' | 'maincredit' | 'artist' | 'albumartist';

export type NdArtistSort = 'name' | 'album_count' | 'song_count' | 'size';

/**
 * Paginated list of artists holding the given participant role on at least one
 * track — the canonical Navidrome path for "Browse by Composer/Conductor/etc."
 * Requires Navidrome 0.55.0+ (uses `library_artist.stats`). Throws on auth or
 * unsupported-server errors; caller should treat that as a capability miss.
 */
export async function ndListArtistsByRole(
  role: NdArtistRole,
  start: number,
  end: number,
  sort: NdArtistSort = 'name',
  order: 'ASC' | 'DESC' = 'ASC',
): Promise<SubsonicArtist[]> {
  const serverId = useAuthStore.getState().activeServerId;
  if (!serverId) throw new Error('No server configured');
  return ndListArtistsByRoleForServer(serverId, role, start, end, sort, order);
}

export async function ndListArtistsByRoleForServer(
  serverId: string,
  role: NdArtistRole,
  start: number,
  end: number,
  sort: NdArtistSort = 'name',
  order: 'ASC' | 'DESC' = 'ASC',
  libraryIdOverride?: string | null,
): Promise<SubsonicArtist[]> {
  const server = getServerById(serverId);
  if (!server) throw new Error(`Unknown server: ${serverId}`);
  const baseUrl = connectBaseUrlForServer(server);
  const libraryId = libraryIdOverride === undefined
    ? currentLibraryIdForServer(serverId)
    : libraryIdOverride;
  const callOnce = async (token: string): Promise<unknown> =>
    invoke<unknown>('nd_list_artists_by_role', {
      serverUrl: baseUrl, token, role, sort, order, start, end, libraryId,
    });

  let token = await getTokenForServer(serverId);
  let raw: unknown;
  try {
    raw = await callOnce(token);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('401') || msg.includes('403')) {
      token = await getTokenForServer(serverId, true);
      raw = await callOnce(token);
    } else {
      throw err;
    }
  }
  if (!Array.isArray(raw)) return [];
  const ownerServerKey = resolveIndexKey(serverId);
  return raw.map(a => ({ ...mapNdArtist(a as Record<string, unknown>, role), serverId: ownerServerKey }));
}

/**
 * Paginated list of albums in which `artistId` holds the given participant role.
 * Subsonic `getArtist.view` only walks AlbumArtist relations, so composer-only
 * (or conductor-only, …) credits are unreachable through it. Navidrome's native
 * filter `role_<role>_id` covers every role from `model.AllRoles`.
 */
export async function ndListAlbumsByArtistRole(
  artistId: string,
  role: NdArtistRole,
  start: number,
  end: number,
  sort: 'name' | 'max_year' | 'recently_added' | 'play_count' = 'name',
  order: 'ASC' | 'DESC' = 'ASC',
): Promise<SubsonicAlbum[]> {
  const serverId = useAuthStore.getState().activeServerId;
  if (!serverId) throw new Error('No server configured');
  return ndListAlbumsByArtistRoleForServer(serverId, artistId, role, start, end, sort, order);
}

export async function ndListAlbumsByArtistRoleForServer(
  serverId: string,
  artistId: string,
  role: NdArtistRole,
  start: number,
  end: number,
  sort: 'name' | 'max_year' | 'recently_added' | 'play_count' = 'name',
  order: 'ASC' | 'DESC' = 'ASC',
  libraryIdOverride?: string | null,
): Promise<SubsonicAlbum[]> {
  const server = getServerById(serverId);
  if (!server) throw new Error(`Unknown server: ${serverId}`);
  const baseUrl = connectBaseUrlForServer(server);
  const libraryId = libraryIdOverride === undefined
    ? currentLibraryIdForServer(serverId)
    : libraryIdOverride;
  const callOnce = async (token: string): Promise<unknown> =>
    invoke<unknown>('nd_list_albums_by_artist_role', {
      serverUrl: baseUrl, token, artistId, role, sort, order, start, end, libraryId,
    });

  let token = await getTokenForServer(serverId);
  let raw: unknown;
  try {
    raw = await callOnce(token);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('401') || msg.includes('403')) {
      token = await getTokenForServer(serverId, true);
      raw = await callOnce(token);
    } else {
      throw err;
    }
  }
  if (!Array.isArray(raw)) return [];
  const ownerServerKey = resolveIndexKey(serverId);
  return raw.map(a => ({ ...mapNdAlbum(a as Record<string, unknown>), serverId: ownerServerKey }));
}

/** Runs a native-API call, re-logging in once when the cached token is rejected. */
async function withNdToken<T>(serverId: string, call: (token: string) => Promise<T>): Promise<T> {
  const token = await getTokenForServer(serverId);
  try {
    return await call(token);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('401') || msg.includes('403')) {
      return call(await getTokenForServer(serverId, true));
    }
    throw err;
  }
}

/** One value of a Navidrome file tag (e.g. a record label). */
export interface NdTagValue {
  id: string;
  value: string;
}

/**
 * Every value of one Navidrome file tag, e.g. `recordlabel`. One request returns
 * the whole list; `tagValue` narrows it to values containing that text. Navidrome
 * 0.55.0+. Throws on auth or unsupported-server errors; callers treat that as a
 * capability miss.
 */
export async function ndListTagsForServer(
  serverId: string,
  tagName: string,
  tagValue?: string,
): Promise<NdTagValue[]> {
  const server = getServerById(serverId);
  if (!server) throw new Error(`Unknown server: ${serverId}`);
  const baseUrl = connectBaseUrlForServer(server);
  const raw = await withNdToken(serverId, token =>
    invoke<unknown>('nd_list_tags', { serverUrl: baseUrl, token, tagName, tagValue: tagValue ?? null }),
  );
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(row => {
    const o = row as Record<string, unknown>;
    const id = asString(o.id);
    return id ? [{ id, value: asString(o.tagValue) }] : [];
  });
}

export interface NdAlbumsByTagPage {
  albums: SubsonicAlbum[];
  /** Albums matching the tag in total; null when the server omits `X-Total-Count`. */
  total: number | null;
}

/**
 * One page of albums carrying a tag value, e.g. every album on a record label.
 * Navidrome exposes each mapped tag name as an album filter keyed by tag id.
 */
export async function ndListAlbumsByTagForServer(
  serverId: string,
  tagName: string,
  tagId: string,
  start: number,
  end: number,
  sort: 'name' | 'max_year' | 'recently_added' | 'play_count' = 'name',
  order: 'ASC' | 'DESC' = 'ASC',
  libraryIdOverride?: string | null,
): Promise<NdAlbumsByTagPage> {
  const server = getServerById(serverId);
  if (!server) throw new Error(`Unknown server: ${serverId}`);
  const baseUrl = connectBaseUrlForServer(server);
  const libraryId = libraryIdOverride === undefined
    ? currentLibraryIdForServer(serverId)
    : libraryIdOverride;
  const raw = await withNdToken(serverId, token =>
    invoke<unknown>('nd_list_albums_by_tag', {
      serverUrl: baseUrl, token, tagName, tagId, sort, order, start, end, libraryId,
    }),
  );
  const o = (raw ?? {}) as Record<string, unknown>;
  const items = Array.isArray(o.items) ? o.items : [];
  const ownerServerKey = resolveIndexKey(serverId);
  return {
    albums: items.map(a => ({ ...mapNdAlbum(a as Record<string, unknown>), serverId: ownerServerKey })),
    total: asNumber(o.total) ?? null,
  };
}

export interface NdLosslessAlbumEntry {
  album: SubsonicAlbum;
  sampleRate: number;
  bitDepth: number;
}

export interface NdLosslessPageRequest {
  /** Resume the song-cursor from a previous call. Default 0 (start fresh). */
  startSongOffset?: number;
  songsPerPage?: number;
  maxPagesPerCall?: number;
  /** Stop once this many *new* unique album ids are collected this call. */
  targetNewAlbums: number;
  /** Mutated as the call walks; keep one Set across calls so repeated invocations
   *  return only albums you haven't seen yet. */
  seenAlbumIds?: Set<string>;
  /** Fires once per internal fetch with the entries discovered in that fetch.
   *  Lets a paginated UI render albums progressively while the rest of the
   *  call is still running — the song endpoint returns ~1 MB per 200-song
   *  fetch, so a single `loadMore` that internally pages 5× otherwise stalls
   *  the spinner for several seconds before any album appears. */
  onProgress?: (entries: NdLosslessAlbumEntry[]) => void;
}

export interface NdLosslessPage {
  entries: NdLosslessAlbumEntry[];
  /** True when the song stream entered lossy territory or the server ran
   *  out of rows — caller should stop paginating. */
  done: boolean;
  /** Pass back as `startSongOffset` on the next call to continue the walk. */
  nextSongOffset: number;
}

/**
 * Fetch a page of lossless albums. Walks the native API's `_sort=bit_depth`
 * song stream (descending) so all 24/32-bit tracks come first, then 16-bit,
 * then lossy formats which report `bit_depth: 0`. Dedupes to unique album
 * ids on the way down and stops as soon as the stream crosses into lossy
 * territory. `_filters` has no operators usable on quality columns so a
 * sort + walk is the only path.
 *
 * Pages through the song stream internally up to `maxPagesPerCall` so albums
 * with many tracks (compilations, big lossless box sets) don't soak up a
 * single fetch window and starve the rest. Stops the internal pagination
 * once `targetNewAlbums` unique ids are collected this call, the song stream
 * crosses into lossy, the server returns a short page, or the per-call cap
 * is hit.
 *
 * Stateful pagination (the dedicated Lossless page) reuses the returned
 * `nextSongOffset` and a long-lived `seenAlbumIds` Set on subsequent calls.
 * Single-shot pagination (the Home rail) just calls once and ignores the
 * resume hooks. Returns empty page on Subsonic-only servers — caller treats
 * that as a silent capability miss.
 */
/** File-extension allowlist of containers that are *only* lossless. Skips
 *  ambiguous wrappers (m4a/m4b — could be ALAC or AAC, codec field is often
 *  empty in Navidrome responses; wma — could be WMA Lossless or WMA Standard)
 *  because they require a codec check we can't reliably perform. */
const LOSSLESS_SUFFIXES = new Set(['flac', 'wav', 'wave', 'aiff', 'aif', 'dsf', 'dff', 'ape', 'wv', 'shn', 'tta']);

export async function ndListLosslessAlbumsPageForServer(
  serverId: string,
  req: NdLosslessPageRequest,
): Promise<NdLosslessPage> {
  const PAGE_SIZE = req.songsPerPage ?? 200;
  const MAX_PAGES = req.maxPagesPerCall ?? 5;
  const targetAlbums = req.targetNewAlbums;
  const seen = req.seenAlbumIds ?? new Set<string>();
  let songOffset = req.startSongOffset ?? 0;

  const server = getServerById(serverId);
  if (!server) throw new Error(`Unknown server: ${serverId}`);
  const ownerServerKey = resolveIndexKey(serverId);
  const baseUrl = connectBaseUrlForServer(server);

  const fetchPage = async (start: number, end: number): Promise<unknown[]> => {
    const callOnce = async (token: string): Promise<unknown> =>
      invoke<unknown>('nd_list_songs', {
        serverUrl: baseUrl,
        token,
        sort: 'bit_depth',
        order: 'DESC',
        start,
        end,
      });

    let token = await getTokenForServer(serverId);
    try {
      const raw = await callOnce(token);
      return Array.isArray(raw) ? raw : [];
    } catch (err) {
      const msg = String(err);
      if (msg.includes('401') || msg.includes('403')) {
        token = await getTokenForServer(serverId, true);
        const raw = await callOnce(token);
        return Array.isArray(raw) ? raw : [];
      }
      throw err;
    }
  };

  const entries: NdLosslessAlbumEntry[] = [];
  let done = false;

  for (let p = 0; p < MAX_PAGES; p++) {
    const songs = await fetchPage(songOffset, songOffset + PAGE_SIZE);
    if (songs.length === 0) { done = true; break; }

    let belowThreshold = false;
    const pageEntries: NdLosslessAlbumEntry[] = [];
    for (const item of songs) {
      if (typeof item !== 'object' || item === null) continue;
      const o = item as Record<string, unknown>;
      const bitDepth = asNumber(o.bitDepth) ?? 0;
      if (bitDepth <= 0) { belowThreshold = true; break; }
      const suffix = (typeof o.suffix === 'string' ? o.suffix : '').toLowerCase();
      if (!LOSSLESS_SUFFIXES.has(suffix)) continue;
      const albumId = asString(o.albumId);
      if (!albumId || seen.has(albumId)) continue;
      seen.add(albumId);

      const album: SubsonicAlbum = {
        serverId: ownerServerKey,
        id: albumId,
        name: asString(o.album),
        artist: asString(o.albumArtist) || asString(o.artist),
        artistId: asString(o.albumArtistId) || asString(o.artistId),
        coverArt: asString(o.coverArtId) || albumId,
        songCount: 0,
        duration: 0,
        year: asNumber(o.year),
        genre: typeof o.genre === 'string' ? o.genre : undefined,
        genres: parseItemGenres(o.genres),
      };
      pageEntries.push({ album, bitDepth, sampleRate: asNumber(o.sampleRate) ?? 0 });
    }

    if (pageEntries.length > 0) {
      entries.push(...pageEntries);
      req.onProgress?.(pageEntries);
    }

    songOffset += songs.length;
    if (belowThreshold) { done = true; break; }
    if (songs.length < PAGE_SIZE) { done = true; break; }
    if (entries.length >= targetAlbums) break;
  }

  return { entries, done, nextSongOffset: songOffset };
}

/** Active-server compatibility wrapper used by the dedicated Lossless Albums page. */
export async function ndListLosslessAlbumsPage(req: NdLosslessPageRequest): Promise<NdLosslessPage> {
  const { activeServerId } = useAuthStore.getState();
  if (!activeServerId) throw new Error('No active server configured');
  return ndListLosslessAlbumsPageForServer(activeServerId, req);
}

/** Drop the cached token AND the songs cache — call when the active server changes. */
export function ndClearTokenCache(): void {
  cachedTokens.clear();
  songsCache.clear();
}

/** Drop the songs cache only (e.g. after a rating mutation). */
export function ndInvalidateSongsCache(): void {
  songsCache.clear();
}
