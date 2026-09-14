import { usePlayerStore } from '../store/playerStore';
import { ownedOverrideValue } from '@/lib/util/ownedEntityKey';
import type { PlayedTrack, TrackPlayStats } from '@/lib/media/trackPlayStats';

/**
 * Play statistics for one row, with this session's plays merged over the values
 * the list was loaded with.
 *
 * The two fields are selected separately on purpose: reading the override entry
 * as an object would hand every subscribed row a fresh reference on every store
 * write and re-render the whole list. A number and a string compare by value, so
 * only the row whose track was played re-renders.
 */
export function useTrackPlayStats(track: PlayedTrack): TrackPlayStats {
  const playCount = usePlayerStore(s => ownedOverrideValue(s.playStatsOverrides, track)?.playCount);
  const played = usePlayerStore(s => ownedOverrideValue(s.playStatsOverrides, track)?.played);
  return {
    playCount: playCount ?? track.playCount,
    played: played ?? track.played,
  };
}
