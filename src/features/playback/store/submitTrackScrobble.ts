import { scrobbleSong } from '@/lib/api/subsonicScrobble';
import type { Track } from '@/lib/media/trackTypes';
import type { TrackPlayStats } from '@/lib/media/trackPlayStats';
import { getMusicNetworkRuntimeOrNull } from '@/music-network';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';

/**
 * Record the play on the rows that are already on screen.
 *
 * Written under both the owner-scoped key and the bare track id: only owned and
 * multi-server rows carry a `serverId`, and a list that renders neither would
 * never find a scoped entry.
 */
function rememberPlayStats(trackId: string, serverId: string, stats: TrackPlayStats): void {
  const setPlayStatsOverride = usePlayerStore.getState().setPlayStatsOverride;
  setPlayStatsOverride(ownedEntityKey({ id: trackId, serverId }), stats);
  setPlayStatsOverride(trackId, stats);
}

/** Submit one play to the owning media server and every enabled Music Network destination. */
export function submitTrackScrobble(
  track: Track,
  serverId: string,
  startedAtMs: number,
): void {
  // The listener did play it, whatever the server makes of the scrobble, so the
  // timestamp goes up immediately. The count is the server's own tally and can
  // only follow once it has been asked what that tally now is.
  rememberPlayStats(track.id, serverId, { played: new Date(startedAtMs).toISOString() });
  void scrobbleSong(track.id, startedAtMs, serverId).then(stats => {
    if (stats) rememberPlayStats(track.id, serverId, stats);
  });
  void getMusicNetworkRuntimeOrNull()?.dispatchScrobble({
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    timestamp: startedAtMs,
  });
}
