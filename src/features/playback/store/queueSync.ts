import { NAVIDROME_PUBLIC_SHARE_SERVER_ID } from '@/lib/share/navidromePublicSharePlayback';
import { savePlayQueue } from '@/lib/api/subsonicPlayQueue';
import type { QueueItemRef, Track } from '@/lib/media/trackTypes';
import { isSubsonicServerReachable } from '@/lib/network/subsonicNetworkGuard';
import {
  filterQueueRefsForPlaybackServer,
  getPlaybackServerId,
  playbackProfileIdForTrack,
} from '@/features/playback/utils/playback/playbackServer';
import { filterQueueRefsForServerProfile } from '@/features/playback/utils/playback/trackServerScope';
import { profileIdFromQueueRef } from '@/lib/media/trackServerScope';
import { getPlaybackProgressSnapshot } from '@/features/playback/store/playbackProgress';
import {
  touchQueueMutationClock,
  isIdleQueuePullSuspended,
  resumeIdleQueuePull,
  markQueuePushFailed,
  clearQueuePushFailed,
  isQueuePushFailed,
  markQueueNaturallyEnded,
  clearAllQueuePushFailures,
} from '@/features/playback/store/queuePlaybackIdle';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import {
  isPlayQueueSyncEnabled,
  usePlayQueueSyncSettingsStore,
} from '@/features/playback/store/playQueueSyncSettingsStore';

/**
 * Server-side play-queue persistence. Subsonic's `savePlayQueue` accepts
 * the current queue, the active track id, and the position in ms — so the
 * server can hand the same playback state back when the user opens
 * another client.
 *
 * Two flush shapes:
 *  - `syncQueueToServer` debounces playback position/queue pushes (track
 *    changes, resume) without blocking idle auto-pull.
 *  - `syncUserQueueMutationToServer` — same debounce plus idle-pull
 *    suspension for user-initiated queue edits.
 *  - `flushQueueSyncToServer` cancels the debounce and pushes immediately —
 *    called from the playback heartbeat, `pause()`, and the app-close path
 *    where the user might switch devices mid-track.
 *
 * Mixed-server queues push only refs owned by the playback server.
 * Queues are capped at 1000 ids to match Subsonic's max-length contract.
 * Radio sessions skip persistence (the seed station is restored separately).
 */

const SYNC_DEBOUNCE_MS = 5000;
const QUEUE_ID_LIMIT = 1000;

const syncTimeoutByServer = new Map<string, ReturnType<typeof setTimeout>>();
const lastQueueHeartbeatAtByServer = new Map<string, number>();

usePlayQueueSyncSettingsStore.subscribe(state => {
  if (state.enabled) return;
  for (const timeout of syncTimeoutByServer.values()) clearTimeout(timeout);
  syncTimeoutByServer.clear();
  clearAllQueuePushFailures();
  resumeIdleQueuePull();
});

function isQueueServerReachable(serverId: string): boolean {
  if (!serverId || serverId === NAVIDROME_PUBLIC_SHARE_SERVER_ID) return false;
  return isSubsonicServerReachable(serverId);
}

function isPlaybackServerReachable(): boolean {
  return isQueueServerReachable(getPlaybackServerId());
}

function queueRefsByServer(queue: QueueItemRef[]): Map<string, QueueItemRef[]> {
  const grouped = new Map<string, QueueItemRef[]>();
  for (const ref of queue) {
    const serverId = profileIdFromQueueRef(ref);
    if (!serverId || serverId === NAVIDROME_PUBLIC_SHARE_SERVER_ID) continue;
    const refs = grouped.get(serverId);
    if (refs) refs.push(ref);
    else grouped.set(serverId, [ref]);
  }
  return grouped;
}

function cancelPendingQueueSync(serverId: string): void {
  const timeout = syncTimeoutByServer.get(serverId);
  if (!timeout) return;
  clearTimeout(timeout);
  syncTimeoutByServer.delete(serverId);
}

/** @returns true when the server accepted the queue (or there was nothing to push). */
function pushRefsForServer(
  refs: QueueItemRef[],
  currentTrack: Track | null,
  currentTime: number,
  serverId: string,
): Promise<boolean> {
  if (!isPlayQueueSyncEnabled()) return Promise.resolve(true);
  if (!serverId || refs.length === 0) return Promise.resolve(true);
  const ids = refs.slice(0, QUEUE_ID_LIMIT).map(r => r.trackId);
  const ownsCurrentTrack = currentTrack != null && playbackProfileIdForTrack(currentTrack) === serverId;
  const currentId = ownsCurrentTrack ? currentTrack.id : ids[0];
  const pos = ownsCurrentTrack ? Math.floor(currentTime * 1000) : 0;
  return savePlayQueue(ids, currentId, pos, serverId).then(
    () => {
      // Server accepted the queue: local and server agree, so any prior failed
      // push is resolved and idle auto-pull can safely resume.
      clearQueuePushFailed(serverId);
      return true;
    },
    () => {
      // Offline / unreachable / URI-too-long: keep local queue authoritative so
      // idle auto-pull cannot rewind to the last successful server snapshot.
      // Transient and self-clearing (next successful push), and does not light
      // the handoff LED — unlike a user edit's `idleQueuePullSuspended`.
      markQueuePushFailed(serverId);
      return false;
    },
  );
}

function scheduleQueueSyncToServer(
  queue: QueueItemRef[],
  currentTrack: Track | null,
  currentTime: number,
): void {
  if (!isPlayQueueSyncEnabled()) return;
  if (!isPlaybackServerReachable()) return;
  const serverId = getPlaybackServerId();
  cancelPendingQueueSync(serverId);
  const timeout = setTimeout(() => {
    syncTimeoutByServer.delete(serverId);
    if (!isPlayQueueSyncEnabled()) return;
    if (!isQueueServerReachable(serverId)) return;
    const refs = filterQueueRefsForServerProfile(queue, serverId);
    void pushRefsForServer(refs, currentTrack, currentTime, serverId);
  }, SYNC_DEBOUNCE_MS);
  syncTimeoutByServer.set(serverId, timeout);
}

function scheduleQueueSyncByServer(
  previousQueue: QueueItemRef[],
  nextQueue: QueueItemRef[],
  currentTrack: Track | null,
  currentTime: number,
): void {
  if (!isPlayQueueSyncEnabled()) return;
  const previousByServer = queueRefsByServer(previousQueue);
  const nextByServer = queueRefsByServer(nextQueue);
  const serverIds = new Set([...previousByServer.keys(), ...nextByServer.keys()]);
  for (const serverId of serverIds) {
    const refs = nextByServer.get(serverId);
    if (!refs) {
      scheduleQueueClearForServer(serverId);
      continue;
    }
    cancelPendingQueueSync(serverId);
    if (!isQueueServerReachable(serverId)) continue;
    const timeout = setTimeout(() => {
      syncTimeoutByServer.delete(serverId);
      if (!isPlayQueueSyncEnabled()) return;
      if (!isQueueServerReachable(serverId)) return;
      void pushRefsForServer(refs, currentTrack, currentTime, serverId);
    }, SYNC_DEBOUNCE_MS);
    syncTimeoutByServer.set(serverId, timeout);
  }
}

function scheduleQueueClearForServer(serverId: string): void {
  cancelPendingQueueSync(serverId);
  if (!isPlayQueueSyncEnabled()) return;
  if (!isQueueServerReachable(serverId)) return;
  const timeout = setTimeout(() => {
    syncTimeoutByServer.delete(serverId);
    if (!isPlayQueueSyncEnabled()) return;
    if (!isQueueServerReachable(serverId)) return;
    void savePlayQueue([], undefined, undefined, serverId).then(
      () => clearQueuePushFailed(serverId),
      () => markQueuePushFailed(serverId),
    );
  }, SYNC_DEBOUNCE_MS);
  syncTimeoutByServer.set(serverId, timeout);
}

/** Debounced push during playback (track advance, resume) — does not suspend idle pull. */
export function syncQueueToServer(queue: QueueItemRef[], currentTrack: Track | null, currentTime: number): void {
  scheduleQueueSyncToServer(queue, currentTrack, currentTime);
}

/** Debounced push after a user queue edit — suspends idle auto-pull until manual sync or Play. */
export function syncUserQueueMutationToServer(
  previousQueue: QueueItemRef[],
  nextQueue: QueueItemRef[],
  currentTrack: Track | null,
  currentTime: number,
): void {
  if (!isPlayQueueSyncEnabled()) return;
  touchQueueMutationClock();
  scheduleQueueSyncByServer(previousQueue, nextQueue, currentTrack, currentTime);
}

/** Debounced multi-owner sync for automatic queue repairs; does not suspend idle pull. */
export function syncAutomaticQueueMutationToServers(
  previousQueue: QueueItemRef[],
  nextQueue: QueueItemRef[],
  currentTrack: Track | null,
  currentTime: number,
): void {
  scheduleQueueSyncByServer(previousQueue, nextQueue, currentTrack, currentTime);
}

/** Debounced remote clear for every server represented by the removed local refs. */
export function syncUserQueueClearToServers(previousQueue: QueueItemRef[]): void {
  if (!isPlayQueueSyncEnabled()) return;
  touchQueueMutationClock();
  for (const serverId of queueRefsByServer(previousQueue).keys()) {
    scheduleQueueClearForServer(serverId);
  }
}

/** @returns true when the push succeeded (or was a no-op). */
export function flushQueueSyncToServer(
  queue: QueueItemRef[],
  currentTrack: Track | null,
  currentTime: number,
): Promise<boolean> {
  const serverId = getPlaybackServerId();
  cancelPendingQueueSync(serverId);
  if (!isPlayQueueSyncEnabled()) return Promise.resolve(true);
  if (!isPlaybackServerReachable()) {
    if (serverId && serverId !== NAVIDROME_PUBLIC_SHARE_SERVER_ID) {
      markQueuePushFailed(serverId);
    }
    return Promise.resolve(false);
  }
  if (!currentTrack || queue.length === 0) return Promise.resolve(true);
  lastQueueHeartbeatAtByServer.set(serverId, Date.now());
  const refs = filterQueueRefsForPlaybackServer(queue);
  return pushRefsForServer(refs, currentTrack, currentTime, serverId);
}

/**
 * Immediate flush of one server's queue slice (e.g. before browse switch).
 * Does not mutate local player state.
 */
export function flushPlayQueueForServer(serverProfileId: string): Promise<boolean> {
  cancelPendingQueueSync(serverProfileId);
  if (!isPlayQueueSyncEnabled()) return Promise.resolve(true);
  if (!serverProfileId) return Promise.resolve(false);
  if (!isSubsonicServerReachable(serverProfileId)) {
    markQueuePushFailed(serverProfileId);
    return Promise.resolve(false);
  }
  const s = usePlayerStore.getState();
  if (s.currentRadio) return Promise.resolve(true);
  const refs = filterQueueRefsForServerProfile(s.queueItems, serverProfileId);
  if (refs.length === 0) return Promise.resolve(true);
  const currentTime = getPlaybackProgressSnapshot().currentTime;
  return pushRefsForServer(refs, s.currentTrack, currentTime, serverProfileId);
}

/** True while a debounced savePlayQueue is scheduled. */
export function hasPendingQueueSync(serverId?: string): boolean {
  if (!isPlayQueueSyncEnabled()) return false;
  return serverId === undefined
    ? syncTimeoutByServer.size > 0
    : syncTimeoutByServer.has(serverId);
}

/** Last heartbeat timestamp (ms epoch). Used by the playback heartbeat to throttle the 15-second auto-flush cadence. */
export function getLastQueueHeartbeatAt(): number {
  return lastQueueHeartbeatAtByServer.get(getPlaybackServerId()) ?? 0;
}

/**
 * Flush the current playerStore queue to the server immediately. Skips
 * radio sessions (the seed station is restored separately). Reads the
 * live current-time via the playback-progress snapshot so the position
 * isn't stale by the debounced store commit.
 */
export function flushPlayQueuePosition(): Promise<boolean> {
  const s = usePlayerStore.getState();
  if (s.currentRadio) return Promise.resolve(true);
  return flushQueueSyncToServer(s.queueItems, s.currentTrack, getPlaybackProgressSnapshot().currentTime);
}

/**
 * Queue exhausted (repeat off): push the final track at end-of-file so idle
 * auto-pull does not rewind to an earlier debounced position on the server.
 */
export function finalizePlayQueueAtTrackEnd(
  queue: QueueItemRef[],
  currentTrack: Track,
): Promise<boolean> {
  cancelPendingQueueSync(getPlaybackServerId());
  markQueueNaturallyEnded();
  const endSec = Math.max(0, currentTrack.duration ?? 0);
  return flushQueueSyncToServer(queue, currentTrack, endSec);
}

/**
 * When the user edited the queue while paused, idle pull is suspended (yellow LED).
 * Starting playback makes this client authoritative — push the local queue immediately
 * and re-enable idle auto-pull (blocked anyway while `isPlaying`).
 */
export function pushQueueOnPlaybackStart(
  queue: QueueItemRef[],
  currentTrack: Track | null,
  currentTime: number,
): void {
  if (!isPlayQueueSyncEnabled()) return;
  if (!currentTrack || queue.length === 0) return;
  const serverId = getPlaybackServerId();
  if (isIdleQueuePullSuspended() || isQueuePushFailed(serverId)) {
    void flushQueueSyncToServer(queue, currentTrack, currentTime).then(ok => {
      if (ok) resumeIdleQueuePull();
    });
    return;
  }
  syncQueueToServer(queue, currentTrack, currentTime);
}

export function flushLocalQueueWhenTakingPlayback(): Promise<void> {
  if (!isPlayQueueSyncEnabled()) return Promise.resolve();
  const serverId = getPlaybackServerId();
  if (!isIdleQueuePullSuspended() && !isQueuePushFailed(serverId)) return Promise.resolve();
  const s = usePlayerStore.getState();
  if (s.currentRadio || !s.currentTrack || s.queueItems.length === 0) {
    return Promise.resolve();
  }
  return flushQueueSyncToServer(
    s.queueItems,
    s.currentTrack,
    getPlaybackProgressSnapshot().currentTime,
  ).then(ok => {
    if (ok) resumeIdleQueuePull();
  });
}

/** Test-only: drop the debounce + reset the heartbeat. */
export function _resetQueueSyncForTest(): void {
  for (const timeout of syncTimeoutByServer.values()) {
    clearTimeout(timeout);
  }
  syncTimeoutByServer.clear();
  lastQueueHeartbeatAtByServer.clear();
}
