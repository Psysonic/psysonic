import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import StarRating from '@/ui/StarRating';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { unifiedTrackRating, type RatableTrack } from '@/lib/media/trackRating';

interface Props<T extends RatableTrack> {
  /** The rows the surrounding bulk toolbar currently acts on. */
  tracks: readonly T[];
  /**
   * The same handler a single row uses. Each list keeps its own map of freshly
   * rated songs and merges it over the fetched data, so going through the
   * row handler is what makes a new rating stay visible; writing to the sync
   * queue alone shows it only until the server round-trip clears the override.
   */
  onRate: (track: T, rating: number) => void;
  /** The list's own freshly-rated map, read ahead of the sync override. */
  ratings?: Record<string, number>;
}

/** Star row that rates every row of a tracklist selection at once. */
export function BulkTrackRating<T extends RatableTrack>({ tracks, onRate, ratings }: Props<T>) {
  const { t } = useTranslation();
  const userRatingOverrides = usePlayerStore(s => s.userRatingOverrides);
  if (tracks.length === 0) return null;
  return (
    <div className="bulk-action-rating">
      <Star size={14} className="bulk-action-rating-icon" aria-hidden />
      <StarRating
        value={unifiedTrackRating(tracks, { ...userRatingOverrides, ...ratings })}
        ariaLabel={t('entityRating.selectedSongsRatingAriaLabel', { count: tracks.length })}
        onChange={rating => {
          for (const track of tracks) onRate(track, rating);
        }}
      />
    </div>
  );
}
