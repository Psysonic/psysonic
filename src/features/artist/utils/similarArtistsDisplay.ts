export interface SimilarArtistsDisplayInput {
  /** The owning server runs AudioMuse, so its own list is the first choice. */
  audiomuseNavidromeEnabled: boolean;
  /** Entries in the server's `similarArtist` list from the artist info. */
  serverCount: number;
  /** Library matches from the Music Network lookup. */
  networkCount: number;
  /** The Music Network lookup for this artist has not settled yet. */
  networkLoading: boolean;
}

export interface SimilarArtistsDisplay {
  showServerSimilar: boolean;
  showNetworkSimilar: boolean;
}

/**
 * Decide which similar-artist list the artist page shows.
 *
 * With AudioMuse the server answers first. Otherwise the service chosen under Music Network
 * does, as that setting promises, and the server's own list — already part of the artist-info
 * response, matched against the library by the server — only fills in once that lookup has
 * settled without a match, or when no service is set up at all. The server list is held back
 * while the lookup is still running, so it never flashes up before the chosen service answers.
 */
export function resolveSimilarArtistsDisplay(input: SimilarArtistsDisplayInput): SimilarArtistsDisplay {
  const { audiomuseNavidromeEnabled, serverCount, networkCount, networkLoading } = input;
  const showServerSimilar = serverCount > 0
    && (audiomuseNavidromeEnabled || (!networkLoading && networkCount === 0));
  const showNetworkSimilar = !showServerSimilar && (networkLoading || networkCount > 0);
  return { showServerSimilar, showNetworkSimilar };
}
