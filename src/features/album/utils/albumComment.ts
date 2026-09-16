import type { SubsonicSong } from '@/lib/api/subsonicTypes';

/**
 * The comment tag to show for a whole album, or `null` when there is none that
 * speaks for the release.
 *
 * The tag lives on the track, but people overwhelmingly use it to say something
 * about the release as a whole. Measured against a real library of 154,549
 * tracks: of 1,104 albums carrying a comment, 918 have the same text on every
 * track and another 55 have it on only some tracks — still one text, usually
 * because a second disc went untagged. Only 131 carry genuinely different texts
 * per track.
 *
 * So the rule is agreement, not completeness: every track that has something to
 * say must say the same thing. Requiring *all* tracks to carry it would drop
 * those 55 albums for no gain, while accepting disagreement would promote one
 * track's note ("alternate take") into a statement about the album.
 */
export function deriveAlbumComment(songs: readonly SubsonicSong[]): string | null {
  let found: string | null = null;
  for (const song of songs) {
    const comment = typeof song.comment === 'string' ? song.comment.trim() : '';
    if (!comment) continue;
    if (found === null) found = comment;
    else if (found !== comment) return null;
  }
  return found;
}
