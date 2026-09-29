import { ownedOverrideValue } from '@/lib/util/ownedEntityKey';

/** Minimal shape of a song/track row that can carry a server-side star rating. */
export interface RatableTrack {
  id: string;
  serverId?: string | null;
  userRating?: number;
}

/** Separator for the composite id below — never part of an entity id. */
const COMPOSITE_ID_SEPARATOR = '\x1e';

/**
 * The rating a whole selection shares, or `0` when the rows disagree.
 *
 * One star row stands for many tracks, so only a unanimous value may be shown:
 * anything else renders as "not rated", which keeps a click unambiguous — it
 * always means "give all of them this rating". Mirrors how the album and
 * artist multi-select rows behave in the context menu.
 */
export function unifiedTrackRating(
  tracks: readonly RatableTrack[],
  overrides: Record<string, number>,
): number {
  if (tracks.length === 0) return 0;
  const ratingOf = (track: RatableTrack) =>
    ownedOverrideValue(overrides, track) ?? track.userRating ?? 0;
  const first = ratingOf(tracks[0]);
  return tracks.every(track => ratingOf(track) === first) ? first : 0;
}

/**
 * Stable id for a selection of tracks, used as the `data-rating-id` of the
 * shared star row so keyboard rating can address the whole group like it
 * addresses a single entity. Sorted, so the id does not depend on click order.
 */
export function multiTrackRatingId(tracks: readonly RatableTrack[]): string {
  return tracks.map(track => track.id).sort().join(COMPOSITE_ID_SEPARATOR);
}
