import { ownedOverrideValue } from '@/lib/util/ownedEntityKey';

/** Minimal shape of a song/track row that can carry server-side play statistics. */
export interface PlayedTrack {
  id: string;
  serverId?: string | null;
  playCount?: number;
  /** ISO timestamp of the last play, as the server reports it. */
  played?: string;
}

export interface TrackPlayStats {
  playCount?: number;
  played?: string;
}

/**
 * The play statistics a row should show: what this session recorded wins over
 * the values the page was loaded with.
 *
 * A list fetches its rows once and keeps them, so a play that happens while it
 * is on screen would otherwise stay invisible until the page is re-entered. The
 * two fields are merged separately because they arrive apart — the timestamp
 * when the scrobble settles, the count once the server has been read back.
 */
export function trackPlayStats(
  track: PlayedTrack,
  overrides: Record<string, TrackPlayStats>,
): TrackPlayStats {
  const override = ownedOverrideValue(overrides, track);
  return {
    playCount: override?.playCount ?? track.playCount,
    played: override?.played ?? track.played,
  };
}
