import { describe, expect, it } from 'vitest';
import { lastFmArtistUrl } from './lastFmArtistUrl';

describe('lastFmArtistUrl', () => {
  it('keeps a Last.fm artist page the server sends', () => {
    expect(lastFmArtistUrl('https://www.last.fm/music/Some+Band', 'Some Band'))
      .toBe('https://www.last.fm/music/Some+Band');
    expect(lastFmArtistUrl('http://last.fm/music/Some+Band', 'Some Band'))
      .toBe('http://last.fm/music/Some+Band');
  });

  it('builds the page from the name when the server sends the artist homepage', () => {
    expect(lastFmArtistUrl('https://some-band.example/', 'Some Band'))
      .toBe('https://www.last.fm/music/Some%20Band');
  });

  it('rejects look-alike hosts and non-artist Last.fm pages', () => {
    expect(lastFmArtistUrl('https://last.fm.example/music/X', 'Some Band'))
      .toBe('https://www.last.fm/music/Some%20Band');
    expect(lastFmArtistUrl('https://notlast.fm/music/X', 'Some Band'))
      .toBe('https://www.last.fm/music/Some%20Band');
    expect(lastFmArtistUrl('https://www.last.fm/user/tester', 'Some Band'))
      .toBe('https://www.last.fm/music/Some%20Band');
    expect(lastFmArtistUrl('javascript:alert(1)//www.last.fm/music/X', 'Some Band'))
      .toBe('https://www.last.fm/music/Some%20Band');
  });

  it('encodes the name and needs one to build a page', () => {
    expect(lastFmArtistUrl(undefined, 'Left/Right')).toBe('https://www.last.fm/music/Left%2FRight');
    expect(lastFmArtistUrl('', '  ')).toBeNull();
    expect(lastFmArtistUrl(undefined, undefined)).toBeNull();
  });
});
