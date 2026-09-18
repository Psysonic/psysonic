/**
 * The Last.fm page for an artist.
 *
 * The server's `lastFmUrl` is used only when it really is a Last.fm artist
 * page. Navidrome fills that field from whichever metadata agent answers first,
 * and its ListenBrainz agent answers with the artist's official homepage
 * (navidrome#6165). Anything else falls back to the page built from the name,
 * which is how Last.fm addresses artists — the rule Navidrome's own web UI
 * applies (`isLastFmURL` in `ui/src/utils/urls.js`).
 */
export function lastFmArtistUrl(
  serverUrl: string | undefined,
  artistName: string | undefined,
): string | null {
  if (serverUrl && isLastFmArtistPage(serverUrl)) return serverUrl;
  const name = artistName?.trim();
  return name ? `https://www.last.fm/music/${encodeURIComponent(name)}` : null;
}

function isLastFmArtistPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      (parsed.hostname === 'last.fm' || parsed.hostname.endsWith('.last.fm')) &&
      parsed.pathname.startsWith('/music/')
    );
  } catch {
    return false;
  }
}
