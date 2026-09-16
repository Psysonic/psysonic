import i18n from '@/lib/i18n';
import { showToast } from '@/lib/dom/toast';
import { useBurnListStore } from '@/features/burner/store/burnListStore';
import { burnJobIsActive, useBurnJobStore } from '@/features/burner/store/burnJobStore';
import { MAX_TRACKS, type BurnQueueTrack } from '@/features/burner/utils/capacity';

/**
 * The fields the burner needs from a track.
 *
 * Structural rather than tied to one type, so both `SubsonicSong` (library
 * views) and `Track` (queue / multi-select promotion) satisfy it without a
 * conversion step at every call site.
 */
export interface BurnableTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverArt?: string;
  suffix?: string;
  size?: number;
}

/** Stable identity across servers — the same track id can exist on two servers. */
export function burnTrackKey(serverId: string, trackId: string): string {
  return `${serverId}:${trackId}`;
}

export function songToBurnTrack(song: BurnableTrack, serverId: string): BurnQueueTrack {
  return {
    key: burnTrackKey(serverId, song.id),
    serverId,
    trackId: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    durationSec: song.duration,
    coverArt: song.coverArt,
    suffix: song.suffix,
    sizeBytes: song.size,
    // Resolved on the Burner page; `undefined` means "not looked up yet".
    localPath: undefined,
  };
}

/**
 * Decide whether the queue may be changed at all, and clear the way if it may.
 *
 * A job snapshots its track list when it starts, so appending to the queue
 * mid-burn leaves the running order on screen describing a disc that is not
 * the one in the drive. That is refused outright.
 *
 * A settled job means that disc is done, and adding now means "I am making a
 * different one". What happens to the queue depends on what it currently is:
 *
 * * **After a real burn that finished**, those tracks are on a disc. Appending
 *   to them builds a running order made of a disc that already exists plus a
 *   new album, which usually overruns the capacity of anything it could be
 *   burned to. So the queue is cleared and the new tracks start the next disc.
 *   Burning a second copy does not come through here: "Burn another" is on the
 *   page and never leaves it.
 * * **After a rehearsal, a failure or a cancel**, no disc was made. The user is
 *   still building this one and may be adding a track before burning it, so the
 *   queue is kept and the tracks are appended.
 *
 * Returns false when nothing may be queued; the toast has already been shown.
 */
function unlockQueueForAdd(): boolean {
  const { status, testWrite, reset } = useBurnJobStore.getState();
  if (burnJobIsActive(status)) {
    showToast(i18n.t('burner.toastBurnInProgress'), 4000, 'info');
    return false;
  }

  const burned = status === 'done' && !testWrite;
  if (status !== 'idle') reset();
  if (burned) {
    useBurnListStore.getState().clear();
    // Said out loud: a running order somebody arranged track by track must not
    // vanish silently, even when replacing it is the right thing to do.
    showToast(i18n.t('burner.toastNewDiscStarted'), 5000, 'info');
  }
  return true;
}

/**
 * Queue tracks for the next disc and tell the user what actually happened.
 *
 * Duplicates and the 99-track ceiling both silently drop tracks, so the toast
 * reports the accepted count rather than what was asked for.
 */
export function addSongsToBurnList(songs: BurnableTrack[], serverId: string): void {
  if (songs.length === 0) return;
  if (!unlockQueueForAdd()) return;

  const before = useBurnListStore.getState().tracks.length;
  const added = useBurnListStore.getState().add(songs.map(song => songToBurnTrack(song, serverId)));

  if (added === 0) {
    showToast(
      before >= MAX_TRACKS
        ? i18n.t('burner.toastDiscFull', { max: MAX_TRACKS })
        : i18n.t('burner.toastAlreadyQueued'),
      4000,
      'info',
    );
    return;
  }

  const skipped = songs.length - added;
  showToast(
    skipped > 0
      ? i18n.t('burner.toastAddedSome', { count: added, skipped })
      : i18n.t('burner.toastAdded', { count: added }),
    4000,
    'info',
  );
}

/**
 * Queue tracks that may span several servers.
 *
 * Multi-select can cross server boundaries in aggregated views, and each track
 * must keep its real owner — streaming, download URLs and metadata all resolve
 * against the server that actually holds the file.
 */
export function addTracksToBurnList(
  tracks: Array<BurnableTrack & { serverId?: string | null }>,
  fallbackServerId: string,
): void {
  const queued = tracks
    .map(track => {
      const serverId = track.serverId || fallbackServerId;
      return serverId ? songToBurnTrack(track, serverId) : null;
    })
    .filter((track): track is BurnQueueTrack => track !== null);

  if (queued.length === 0) return;
  if (!unlockQueueForAdd()) return;

  const before = useBurnListStore.getState().tracks.length;
  const added = useBurnListStore.getState().add(queued);

  if (added === 0) {
    showToast(
      before >= MAX_TRACKS
        ? i18n.t('burner.toastDiscFull', { max: MAX_TRACKS })
        : i18n.t('burner.toastAlreadyQueued'),
      4000,
      'info',
    );
    return;
  }

  const skipped = queued.length - added;
  showToast(
    skipped > 0
      ? i18n.t('burner.toastAddedSome', { count: added, skipped })
      : i18n.t('burner.toastAdded', { count: added }),
    4000,
    'info',
  );
}
