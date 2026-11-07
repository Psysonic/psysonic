import { getAlbumInfo2 } from '@/lib/api/subsonicAlbumInfo';
import { isLanUrl } from '@/lib/server/serverEndpoint';
import { commands } from '@/generated/bindings';
import type { CoverSourcePref } from '@/cover/coverSources';
import { isRealArtistImage } from '@/cover/isRealArtistImage';

/**
 * Query-param keys that carry a replayable Subsonic (or generic API) secret.
 * Any URL carrying one of these must never be published to Discord — its
 * external image proxy exposes the full source URL to anyone viewing the
 * presence. Checked case-insensitively; Subsonic's own keys (`u`/`t`/`s`) are
 * lower-case but the defensive variants guard against other backends.
 */
const CREDENTIAL_PARAM_KEYS = new Set(['u', 't', 's', 'p', 'apikey', 'jwt', 'token', 'auth']);

/**
 * Gate every URL before it may become a Discord `large_image`. Discord's
 * external image proxy re-publishes the source URL to anyone who can view
 * the presence, so this rejects anything that isn't safe to publish:
 * https only, no embedded userinfo, no auth-shaped query params, no
 * LAN/loopback host (dead weight for Discord, reveals network topology).
 */
export function sanitizeDiscordCoverUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  for (const key of url.searchParams.keys()) {
    if (CREDENTIAL_PARAM_KEYS.has(key.toLowerCase())) return null;
  }
  if (isLanUrl(url.origin)) return null;
  return url.toString();
}

/**
 * Prepare a raw cover URL returned by a server's `getAlbumInfo2` for Discord publishing.
 *
 * 1. Relative paths (`/share/img/...`) are joined onto `shareBase`, preserving any path prefix.
 * 2. Server share endpoints (`/share/img/`) on absolute URLs are rewritten to `shareBase`'s origin
 *    and path prefix (so LAN-scoped addresses point to the public share base).
 * 3. External image providers (Last.fm, Spotify, MusicBrainz, etc.) must NEVER have their origin
 *    replaced with `shareBase` — doing so causes 404s on the user's music server.
 * 4. External HTTP URLs are upgraded to HTTPS when not on LAN so Discord's image proxy can fetch them.
 */
export function normalizeServerCoverUrl(
  raw: string,
  shareBase: string | null,
  serverAddresses?: readonly string[] | null,
): string {
  const trimmed = raw.trim();
  if (!trimmed) return raw;

  // Protocol-relative URLs (e.g. "//cdn.example.com/art.jpg") -> force https:
  if (trimmed.startsWith('//')) {
    try {
      const url = new URL(`https:${trimmed}`);
      return url.toString();
    } catch {
      return raw;
    }
  }

  // Relative path on server (e.g. "/share/img/<token>?size=600")
  if (trimmed.startsWith('/') || !trimmed.includes('://')) {
    if (!shareBase) return raw;
    try {
      const share = new URL(shareBase);
      const sharePrefix = share.pathname.replace(/\/$/, '');
      const pathWithSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
      const prefixSegment = sharePrefix ? `${sharePrefix}/` : '';
      const fullPath =
        sharePrefix && (pathWithSlash === sharePrefix || pathWithSlash.startsWith(prefixSegment))
          ? pathWithSlash
          : `${sharePrefix}${pathWithSlash}`;
      return new URL(fullPath, share.origin).toString();
    } catch {
      return raw;
    }
  }

  try {
    const url = new URL(trimmed);

    // Only rewrite /share/img/ paths if the URL matches the server's addresses, shareBase, or is on LAN
    const isServerScoped =
      Boolean(shareBase && url.hostname === new URL(shareBase).hostname) ||
      Boolean(
        serverAddresses?.some(addr => {
          try {
            return url.hostname === new URL(addr).hostname;
          } catch {
            return false;
          }
        }),
      ) ||
      isLanUrl(url.origin);

    if (url.pathname.includes('/share/img/') && isServerScoped) {
      if (!shareBase) return url.toString();
      const share = new URL(shareBase);
      url.protocol = share.protocol;
      url.hostname = share.hostname;
      url.port = share.port;
      const sharePrefix = share.pathname.replace(/\/$/, '');
      const prefixSegment = sharePrefix ? `${sharePrefix}/` : '';
      if (sharePrefix && !(url.pathname === sharePrefix || url.pathname.startsWith(prefixSegment))) {
        url.pathname = `${sharePrefix}${url.pathname}`;
      }
      return url.toString();
    }

    // External image provider (e.g. Last.fm CDN, Spotify CDN).
    // Do NOT rewrite origin to shareBase. Upgrade standard HTTP (port 80 or omitted) to HTTPS for public domains.
    if (url.protocol === 'http:' && !isLanUrl(url.origin) && (!url.port || url.port === '80')) {
      url.protocol = 'https:';
      url.port = '';
    }

    return url.toString();
  } catch {
    return raw;
  }
}

interface ServerCoverCacheEntry {
  url: string | null;
  fetchedAt: number;
}

/**
 * Session cache: `"<shareBase>|<albumId>"` -> resolved (already sanitized)
 * cover URL, or `null` for a miss/failure.
 *
 * Hits are cached for 1 hour to prevent redundant requests. Misses and transient
 * errors are cached for 30 seconds so a brief network glitch or startup delay does
 * not poison the cover lookup for the rest of the session.
 */
const SERVER_COVER_CACHE_TTL_MS = 60 * 60 * 1000;
const SERVER_COVER_NEGATIVE_CACHE_TTL_MS = 30 * 1000;
const serverCoverCache = new Map<string, ServerCoverCacheEntry>();

export function _resetServerCoverCacheForTest(): void {
  serverCoverCache.clear();
}

/**
 * Resolve a credential-free Discord cover URL for `albumId` via the
 * standard Subsonic `getAlbumInfo2` endpoint. Deliberately takes only an
 * album id and a share-base string — never a server profile/credentials —
 * so this resolver has no way to construct an authenticated URL, unlike the
 * removed `coverArtUrlForDiscord` that leaked `u`/`t`/`s` (see PR #1246).
 */
export async function resolveServerCoverForDiscord(
  albumId: string,
  shareBase: string | null,
  serverAddresses?: readonly string[] | null,
): Promise<string | null> {
  const cacheKey = `${shareBase ?? ''}|${albumId}`;
  const cached = serverCoverCache.get(cacheKey);
  if (cached) {
    const ttl = cached.url ? SERVER_COVER_CACHE_TTL_MS : SERVER_COVER_NEGATIVE_CACHE_TTL_MS;
    if (Date.now() - cached.fetchedAt < ttl) {
      return cached.url;
    }
  }

  let result: string | null = null;
  const info = await getAlbumInfo2(albumId);
  const raw = info?.largeImageUrl || info?.mediumImageUrl || info?.smallImageUrl;
  if (raw) {
    const normalized = normalizeServerCoverUrl(raw, shareBase, serverAddresses);
    const clean = sanitizeDiscordCoverUrl(normalized);
    if (clean && isRealArtistImage(clean)) {
      result = clean;
    }
  }

  serverCoverCache.set(cacheKey, { url: result, fetchedAt: Date.now() });
  return result;
}

export interface CoverResolveContext {
  albumId?: string;
  artist?: string;
  album?: string;
  title?: string;
  shareBase: string | null;
  serverAddresses?: readonly string[] | null;
}

/**
 * Walk the ordered cover-source chain to a publishable Discord URL.
 * First enabled source yielding a real, sanitized, non-placeholder URL wins.
 * Server resolves frontend-side; apple via `resolveAppleCover` (typedError
 * shape); lastfm via `resolveLastfmCover` (bare `string | null`).
 */
export async function resolveCoverForDiscord(
  prefs: CoverSourcePref[],
  ctx: CoverResolveContext,
): Promise<string | null> {
  for (const { source, enabled } of prefs) {
    if (!enabled) continue;
    let raw: string | null = null;
    switch (source) {
      case 'server':
        if (ctx.albumId) raw = await resolveServerCoverForDiscord(ctx.albumId, ctx.shareBase, ctx.serverAddresses);
        break;
      case 'apple':
        if (ctx.artist && ctx.album) {
          const res = await commands.resolveAppleCover(ctx.artist, ctx.album, ctx.title ?? '');
          raw = res.status === 'ok' ? res.data : null;
        }
        break;
      case 'lastfm':
        if (ctx.artist && ctx.album) {
          raw = await commands.resolveLastfmCover(ctx.artist, ctx.album);
        }
        break;
    }
    if (!raw) continue;
    const clean = sanitizeDiscordCoverUrl(raw);
    // Placeholder filter: covers the server source (Navidrome can aggregate the
    // Last.fm placeholder) and is harmless for apple/lastfm. The Rust LastFM
    // provider also filters it, so this is belt-and-suspenders.
    if (clean && isRealArtistImage(clean)) return clean;
  }
  return null;
}
