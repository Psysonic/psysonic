import { useAuthStore } from '@/store/authStore';

/** Whether star ratings and rating controls are shown (Settings → Library → Ratings, #1779). */
export function useShowStarRatings(): boolean {
  return useAuthStore(s => s.showStarRatings);
}

/** A tracklist's columns without the rating column while ratings are hidden. */
export function withoutRatingColumn<T extends { key: string }>(columns: readonly T[], show: boolean): readonly T[] {
  return show ? columns : columns.filter(c => c.key !== 'rating');
}
