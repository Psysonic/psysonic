import type { SonicSimilarMatch } from '@/lib/api/subsonicArtists';
import type { SubsonicAlbum, SubsonicSong } from '@/lib/api/subsonicTypes';

export const SIMILAR_ALBUMS_MAX_SEEDS = 3;
export const SIMILAR_ALBUMS_LIMIT = 12;

/**
 * Up to `max` distinct tracks spread over the album to seed the similarity
 * lookups: the most-played track (when play counts exist), then the first and
 * the middle track, then evenly spaced fill. One seed per region keeps a single
 * outlier track from dominating the result.
 */
export function pickSimilarSeeds(songs: readonly SubsonicSong[], max = SIMILAR_ALBUMS_MAX_SEEDS): SubsonicSong[] {
  if (songs.length === 0 || max <= 0) return [];
  const picked: SubsonicSong[] = [];
  const add = (song: SubsonicSong | undefined) => {
    if (song && picked.length < max && !picked.some(p => p.id === song.id)) picked.push(song);
  };

  let mostPlayed: SubsonicSong | undefined;
  for (const song of songs) {
    if ((song.playCount ?? 0) > (mostPlayed?.playCount ?? 0)) mostPlayed = song;
  }
  add(mostPlayed);
  add(songs[0]);
  add(songs[Math.floor(songs.length / 2)]);
  for (let i = 1; picked.length < max && i < max * 2; i++) {
    add(songs[Math.floor((i * songs.length) / (max * 2))]);
  }
  return picked;
}

function albumArtistOf(song: SubsonicSong): { artist: string; artistId: string } {
  const ref = song.albumArtists?.find(a => a.id || a.name);
  return {
    artist: song.displayAlbumArtist || ref?.name || song.artist,
    artistId: ref?.id ?? song.artistId ?? '',
  };
}

/**
 * Folds sonic matches from several seed lookups into album cards, strongest
 * first. An album's score is the sum of its tracks' `similarity`; a match the
 * server sent without a score counts as 1, so scoreless servers rank by hit
 * count. Ties keep the order the albums were first seen in (the server returns
 * closest matches first). The current album and albums by the current album's artist are left
 * out — the page already lists those under "More by artist".
 */
export function aggregateSimilarAlbums(
  matches: readonly SonicSimilarMatch[],
  currentAlbumId: string,
  currentArtistId: string | undefined,
  limit = SIMILAR_ALBUMS_LIMIT,
): SubsonicAlbum[] {
  const byAlbum = new Map<string, { album: SubsonicAlbum; score: number; order: number }>();
  for (const { song, similarity } of matches) {
    if (!song.albumId || song.albumId === currentAlbumId) continue;
    const weight = similarity ?? 1;
    const existing = byAlbum.get(song.albumId);
    if (existing) {
      existing.score += weight;
      continue;
    }
    const { artist, artistId } = albumArtistOf(song);
    if (currentArtistId && artistId === currentArtistId) continue;
    byAlbum.set(song.albumId, {
      score: weight,
      order: byAlbum.size,
      album: {
        id: song.albumId,
        name: song.album,
        artist,
        artistId,
        coverArt: song.coverArt,
        year: song.year,
        songCount: 0,
        duration: 0,
        ...(song.serverId ? { serverId: song.serverId } : {}),
      },
    });
  }
  return [...byAlbum.values()]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map(entry => entry.album);
}
