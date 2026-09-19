import { describe, expect, it } from 'vitest';
import { resolveSimilarArtistsDisplay } from './similarArtistsDisplay';

const base = {
  audiomuseNavidromeEnabled: false,
  serverCount: 0,
  networkCount: 0,
  networkLoading: false,
};

describe('resolveSimilarArtistsDisplay', () => {
  it('prefers the Music Network matches over the server list without AudioMuse', () => {
    expect(resolveSimilarArtistsDisplay({ ...base, serverCount: 5, networkCount: 3 }))
      .toEqual({ showServerSimilar: false, showNetworkSimilar: true });
  });

  it('holds the server list back while the Music Network lookup is running', () => {
    expect(resolveSimilarArtistsDisplay({ ...base, serverCount: 5, networkLoading: true }))
      .toEqual({ showServerSimilar: false, showNetworkSimilar: true });
  });

  it('falls back to the server list once the lookup settles without a match', () => {
    expect(resolveSimilarArtistsDisplay({ ...base, serverCount: 5 }))
      .toEqual({ showServerSimilar: true, showNetworkSimilar: false });
  });

  it('shows the server list first under AudioMuse, even while a lookup would run', () => {
    expect(resolveSimilarArtistsDisplay({
      ...base, audiomuseNavidromeEnabled: true, serverCount: 5, networkCount: 3, networkLoading: true,
    })).toEqual({ showServerSimilar: true, showNetworkSimilar: false });
  });

  it('uses the lookup under AudioMuse when the server list is empty', () => {
    expect(resolveSimilarArtistsDisplay({ ...base, audiomuseNavidromeEnabled: true, networkCount: 2 }))
      .toEqual({ showServerSimilar: false, showNetworkSimilar: true });
  });

  it('shows nothing when neither source has an artist', () => {
    expect(resolveSimilarArtistsDisplay(base))
      .toEqual({ showServerSimilar: false, showNetworkSimilar: false });
  });
});
