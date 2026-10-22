import { describe, expect, it } from 'vitest';
import { isServerArtworkUrl } from './isRealArtistImage';

describe('isServerArtworkUrl', () => {
  it('matches the server’s public image endpoint, also below a sub-path', () => {
    expect(isServerArtworkUrl('https://music.example.test/share/img/abc?size=600')).toBe(true);
    expect(isServerArtworkUrl('https://example.test/navidrome/share/img/abc')).toBe(true);
  });

  it('leaves external and malformed URLs alone', () => {
    expect(isServerArtworkUrl('https://images.example.test/i/u/300x300/abc.png')).toBe(false);
    expect(isServerArtworkUrl('not a url /share/img/')).toBe(false);
    expect(isServerArtworkUrl(undefined)).toBe(false);
  });
});
