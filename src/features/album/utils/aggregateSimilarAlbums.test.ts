import { describe, expect, it } from 'vitest';
import { makeSubsonicSong } from '@/test/helpers/factories';
import { aggregateSimilarAlbums, pickSimilarSeeds } from '@/features/album/utils/aggregateSimilarAlbums';

function track(albumId: string, artistId: string, extra: Record<string, unknown> = {}, similarity?: number) {
  const song = makeSubsonicSong({ albumId, album: `Album ${albumId}`, artistId, artist: `Artist ${artistId}`, ...extra });
  return similarity === undefined ? { song } : { song, similarity };
}

describe('pickSimilarSeeds', () => {
  it('returns nothing for an empty album', () => {
    expect(pickSimilarSeeds([])).toEqual([]);
  });

  it('prefers the most-played track, then first and middle', () => {
    const songs = Array.from({ length: 10 }, (_, i) => makeSubsonicSong({ id: `s${i}`, playCount: i === 7 ? 50 : 1 }));
    expect(pickSimilarSeeds(songs).map(s => s.id)).toEqual(['s7', 's0', 's5']);
  });

  it('never repeats a track and caps at the album size', () => {
    const songs = [makeSubsonicSong({ id: 'a' }), makeSubsonicSong({ id: 'b' })];
    const ids = pickSimilarSeeds(songs).map(s => s.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('aggregateSimilarAlbums', () => {
  it('without scores, ranks albums by hit count, ties by first-seen order', () => {
    const albums = aggregateSimilarAlbums([
      track('x', 'ax'),
      track('y', 'ay'),
      track('z', 'az'),
      track('z', 'az'),
      track('y', 'ay'),
      track('z', 'az'),
    ], 'current', 'me');
    expect(albums.map(a => a.id)).toEqual(['z', 'y', 'x']);
  });

  it('ranks by summed similarity when the server sends scores', () => {
    const albums = aggregateSimilarAlbums([
      track('close', 'a1', {}, 0.95),
      track('many-weak', 'a2', {}, 0.3),
      track('many-weak', 'a2', {}, 0.3),
      track('mid', 'a3', {}, 0.5),
      track('mid', 'a3', {}, 0.5),
    ], 'current', 'me');
    expect(albums.map(a => a.id)).toEqual(['mid', 'close', 'many-weak']);
  });

  it('drops the current album and albums by the current artist', () => {
    const albums = aggregateSimilarAlbums([
      track('current', 'me'),
      track('other-by-me', 'me'),
      track('keep', 'someone'),
    ], 'current', 'me');
    expect(albums.map(a => a.id)).toEqual(['keep']);
  });

  it('uses the album artist rather than the track artist', () => {
    const albums = aggregateSimilarAlbums([
      track('comp', 'guest', {
        albumArtists: [{ id: 'va', name: 'Various Artists' }],
        displayAlbumArtist: 'Various Artists',
      }),
      track('by-me-with-guest', 'guest', { albumArtists: [{ id: 'me', name: 'Me' }] }),
    ], 'current', 'me');
    expect(albums).toHaveLength(1);
    expect(albums[0]).toMatchObject({ id: 'comp', artist: 'Various Artists', artistId: 'va' });
  });

  it('carries card fields and the owning server', () => {
    const [album] = aggregateSimilarAlbums([
      track('a1', 'ar', { coverArt: 'cov', year: 1999, serverId: 'srv-b' }),
    ], 'current', undefined);
    expect(album).toMatchObject({ id: 'a1', name: 'Album a1', coverArt: 'cov', year: 1999, serverId: 'srv-b' });
  });

  it('respects the limit', () => {
    const tracks = Array.from({ length: 20 }, (_, i) => track(`al${i}`, `ar${i}`));
    expect(aggregateSimilarAlbums(tracks, 'current', 'me', 5)).toHaveLength(5);
  });
});
