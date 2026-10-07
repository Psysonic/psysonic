import type { Track } from '@/lib/media/trackTypes';
import { canonicalQueueServerKey } from '@/lib/server/serverIndexKey';
import { onNaturalTrackEnd, usePlayerStore, type QueueSource } from '@/features/playback';
import { isPrivateModeActive } from '@/features/privateMode';
import {
  resumePointKey,
  useResumePointsStore,
  type ResumePoint,
  type ResumeSession,
} from './resumePointsStore';

type PlayerSnapshot = ReturnType<typeof usePlayerStore.getState>;

/** Where the queue last stood inside the current session. */
interface SessionSnapshot {
  track: Track;
  queueIndex: number;
  queueLength: number;
  positionSec: number;
}

export interface ResumeTrackerDeps {
  /** Display name of a playlist, from whatever the app already holds. */
  playlistName: (id: string, serverId?: string) => string | undefined;
}

let snapshot: SessionSnapshot | null = null;

function sameSource(a: QueueSource | null, b: QueueSource | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.id === b.id && a.serverId === b.serverId && !!a.shuffled === !!b.shuffled;
}

function sessionFor(state: PlayerSnapshot): ResumeSession | null {
  const source = state.queueSource;
  // A list started in random order has no resume position.
  if (!source || source.shuffled || state.shuffleMode) return null;
  const serverKey = canonicalQueueServerKey(
    source.serverId ?? state.currentTrack?.serverId ?? state.queueServerId ?? '',
  );
  const existing = useResumePointsStore.getState().points.some(point => (
    resumePointKey(point) === resumePointKey({ kind: source.kind, id: source.id, serverKey })
  ));
  // Continuing a list that already has a point counts as having qualified.
  return {
    kind: source.kind,
    id: source.id,
    serverId: source.serverId,
    serverKey,
    qualified: existing,
    finished: false,
  };
}

function isLastInQueue(state: PlayerSnapshot): boolean {
  return state.repeatMode !== 'all' && state.queueIndex >= state.queueItems.length - 1;
}

/**
 * Follow the queue position while a session runs. Stopping, clearing or a
 * natural end resets `currentTime` to 0 on the same track before the queue
 * moves on, so a zero never overwrites a known position of that track.
 */
function noteSnapshot(state: PlayerSnapshot): void {
  const track = state.currentTrack;
  if (!track) return;
  const sameTrack = snapshot?.track.id === track.id && snapshot.queueIndex === state.queueIndex;
  const positionSec = sameTrack && state.currentTime <= 0 ? snapshot!.positionSec : state.currentTime;
  if (!sameTrack) {
    const session = useResumePointsStore.getState().session;
    // Moving back into the list after it ran out makes it resumable again.
    if (session?.finished && !isLastInQueue(state)) {
      useResumePointsStore.getState().updateSession({ finished: false });
    }
  }
  snapshot = {
    track,
    queueIndex: state.queueIndex,
    queueLength: state.queueItems.length,
    positionSec: Number.isFinite(positionSec) ? Math.max(0, positionSec) : 0,
  };
}

function leaveSession(session: ResumeSession, deps: ResumeTrackerDeps): void {
  const store = useResumePointsStore.getState();
  if (session.finished) {
    store.removePoint(session);
    return;
  }
  // Private mode records no listening; an unqualified session never earned a point.
  if (!session.qualified || !snapshot || isPrivateModeActive()) return;
  const { track } = snapshot;
  const previous = store.points.find(point => resumePointKey(point) === resumePointKey(session));
  const name = session.kind === 'album'
    ? track.album
    : deps.playlistName(session.id, session.serverId) ?? previous?.name ?? '';
  const point: ResumePoint = {
    kind: session.kind,
    id: session.id,
    serverId: session.serverId,
    serverKey: session.serverKey,
    name,
    trackId: track.id,
    trackIndex: snapshot.queueIndex,
    trackCount: snapshot.queueLength,
    positionSec: snapshot.positionSec,
    durationSec: track.duration ?? 0,
    cover: { albumId: track.albumId, coverArt: track.coverArt, discNumber: track.discNumber },
    updatedAt: Date.now(),
  };
  store.savePoint(point);
}

function enterSession(state: PlayerSnapshot): void {
  snapshot = null;
  const session = sessionFor(state);
  useResumePointsStore.getState().setSession(session);
  if (session) noteSnapshot(state);
}

/**
 * Turn queue changes into resume points: a list started from its page opens a
 * session, a track of it played to the end qualifies the session, and leaving
 * it (another list, a cleared queue) stores where playback stood. Running out
 * removes the point instead.
 */
export function initResumeTracker(deps: ResumeTrackerDeps): () => void {
  const initial = usePlayerStore.getState();
  const persisted = useResumePointsStore.getState().session;
  const fresh = sessionFor(initial);
  // Keep a persisted session only while the restored queue still belongs to it.
  if (persisted && fresh && resumePointKey(persisted) === resumePointKey(fresh)) {
    snapshot = null;
    noteSnapshot(initial);
  } else {
    enterSession(initial);
  }

  const unsubscribeStore = usePlayerStore.subscribe((state, prev) => {
    if (!sameSource(state.queueSource, prev.queueSource)) {
      const session = useResumePointsStore.getState().session;
      if (session) leaveSession(session, deps);
      enterSession(state);
      return;
    }
    if (!useResumePointsStore.getState().session) return;
    if (
      state.currentTrack !== prev.currentTrack
      || state.queueIndex !== prev.queueIndex
      || state.currentTime !== prev.currentTime
    ) {
      noteSnapshot(state);
    }
  });

  const unsubscribeEnd = onNaturalTrackEnd(() => {
    const store = useResumePointsStore.getState();
    if (!store.session) return;
    const state = usePlayerStore.getState();
    if (!state.currentTrack || state.currentRadio) return;
    const finished = isLastInQueue(state);
    if (!store.session.qualified || store.session.finished !== finished) {
      store.updateSession({ qualified: true, finished });
    }
  });

  return () => {
    unsubscribeStore();
    unsubscribeEnd();
    snapshot = null;
  };
}

/** Test-only reset of the module snapshot. */
export function _resetResumeTrackerForTest(): void {
  snapshot = null;
}
