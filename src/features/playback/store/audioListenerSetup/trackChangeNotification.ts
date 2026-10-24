import { resolvePlaybackCoverScope } from '@/cover/ref';
import { resolveTrackCoverRefFromLibrary } from '@/cover/resolveEntryLibrary';
import { coverArtPathForNotification } from '@/cover/integrations/notification';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { trackNotificationContent } from '@/features/playback/utils/notifications/trackNotificationContent';
import {
  trackNotificationScheduler,
  type TrackNotificationScheduler,
} from '@/features/playback/utils/notifications/trackNotificationScheduler';
import type { Track } from '@/lib/media/trackTypes';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';

function trackKey(track: Track | null): string | null {
  return track ? `track:${ownedEntityKey(track)}` : null;
}

async function trackCoverPath(track: Track): Promise<string | null> {
  if (!track.coverArt || !track.albumId) return null;
  const ref = await resolveTrackCoverRefFromLibrary(
    {
      id: track.id,
      albumId: track.albumId,
      coverArt: track.coverArt,
      discNumber: (track as { discNumber?: number }).discNumber,
    },
    resolvePlaybackCoverScope(),
  );
  return ref ? coverArtPathForNotification(ref) : null;
}

/**
 * Desktop notification when the current track changes. The track restored at
 * startup is not announced, and pause/resume never is — only a new track.
 * Whether a Psysonic window has focus is decided natively when it is shown.
 */
export function setupTrackChangeNotification(
  scheduler: TrackNotificationScheduler = trackNotificationScheduler,
): () => void {
  let prevKey = trackKey(usePlayerStore.getState().currentTrack);

  const unsubscribe = usePlayerStore.subscribe(state => {
    const key = trackKey(state.currentTrack);
    if (key === prevKey) return;
    prevKey = key;
    const track = state.currentTrack;
    if (!track || !key || state.currentRadio) return;
    scheduler.announce(
      key,
      async () => ({ ...trackNotificationContent(track), coverPath: await trackCoverPath(track) }),
      () => {
        const now = usePlayerStore.getState();
        return now.isPlaying && !now.currentRadio && trackKey(now.currentTrack) === key;
      },
    );
  });

  return () => {
    unsubscribe();
    scheduler.dispose();
  };
}
