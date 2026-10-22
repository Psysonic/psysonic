/**
 * Filter out the well-known Last.fm "no image" placeholder that Subsonic
 * backends aggregate into `largeImageUrl`/`mediumImageUrl` when no real
 * artist image exists. The placeholder MD5 is fixed and documented.
 */
export function isRealArtistImage(url?: string): boolean {
  if (!url) return false;
  if (url.includes('2a96cbd8b46e442fc41c2b86b821562f')) return false;
  return true;
}

/**
 * Navidrome answers `getArtistInfo2` with its own public image endpoint
 * (`/share/img/<token>`) — the same artwork `getCoverArt` serves, not an
 * external one. That URL stays identical after an upload and the webview
 * keeps answering it from its HTTP cache, so the old image stays; the cover
 * pipeline is the place for server art.
 */
export function isServerArtworkUrl(url?: string): boolean {
  if (!url) return false;
  try {
    return new URL(url).pathname.includes('/share/img/');
  } catch {
    return false;
  }
}
