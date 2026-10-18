import { createPlaylist, deletePlaylist, getPlaylistForServer, getPlaylistsForServer, addSongsToPlaylist } from '@/lib/api/subsonicPlaylists';
import { getSongForServer } from '@/lib/api/subsonicLibrary';
import { songToTrack } from '@/lib/media/songToTrack';
import { useAuthStore } from '@/store/authStore';
import { usePlaylistMembershipStore } from '@/store/playlistMembershipStore';
import {
  orbitBindingIsCurrent,
  orbitBindingRevisionIsCurrent,
  useOrbitStore,
} from '@/features/orbit/store/orbitStore';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import {
  orbitOutboxPlaylistName,
  type OrbitQueueItem,
  type OrbitState,
} from '@/features/orbit/api/orbit';
import { suggestionKey } from '@/features/orbit/utils/helpers';
import { notePendingSuggestion } from '@/features/orbit/utils/pendingResend';
import { findSessionPlaylistId, readOrbitState, writeOrbitHeartbeat } from '@/features/orbit/utils/remote';
import { orbitActionServerMatches } from '@/features/orbit/utils/orbitServerScope';
import { showToast } from '@/lib/dom/toast';
import i18n from '@/lib/i18n';

export class OrbitJoinError extends Error {
  constructor(
    public readonly reason: 'not-found' | 'ended' | 'full' | 'kicked' | 'no-user' | 'server-error',
    message: string,
  ) {
    super(message);
    this.name = 'OrbitJoinError';
  }
}

export const ORBIT_JOIN_ERROR_KEYS: Record<OrbitJoinError['reason'], string> = {
  'not-found': 'orbit.joinErrNotFound',
  ended: 'orbit.joinErrEnded',
  full: 'orbit.joinErrFull',
  kicked: 'orbit.joinErrKicked',
  'no-user': 'orbit.joinErrNoUser',
  'server-error': 'orbit.joinErrServerError',
};

/** i18n key for a failed join: the text for its reason, or the generic failure. */
export function orbitJoinErrorKey(err: unknown): string {
  return err instanceof OrbitJoinError ? ORBIT_JOIN_ERROR_KEYS[err.reason] : 'orbit.toastJoinFail';
}

/**
 * Guest: join an existing session by id.
 *
 * Assumes the user is already authenticated against the correct Navidrome
 * server — the caller's UI layer handles the magic-sharing flow when the
 * encoded server in the share link doesn't match the active one.
 *
 * Side effects on success:
 *   - creates this user's outbox playlist and writes a first heartbeat
 *   - binds `useOrbitStore` to the session (role = guest, phase = active)
 *   - populates the store's `state` mirror with the last-known blob
 *
 * Throws `OrbitJoinError` on any gate failure; caller shows an error
 * modal and does nothing else.
 */
export async function joinOrbitSession(sid: string, requestedServerId?: string): Promise<OrbitState> {
  const auth = useAuthStore.getState();
  const server = requestedServerId
    ? auth.servers.find(candidate => candidate.id === requestedServerId)
    : auth.getActiveServer();
  const username = server?.username;
  if (!server || !username) throw new OrbitJoinError('no-user', 'No active Navidrome server / user');
  const serverId = server.id;

  const store = useOrbitStore.getState();
  if (store.phase !== 'idle') {
    throw new OrbitJoinError('server-error', `Cannot join while phase is ${store.phase}`);
  }
  const joinRevision = store.bindingRevision;

  store.setPhase('joining');

  let outboxPlaylistId: string | null = null;
  try {
    // 1) Locate the session playlist and read its state blob.
    const sessionPlaylistId = await findSessionPlaylistId(sid, serverId);
    if (!orbitBindingRevisionIsCurrent(joinRevision)) throw new OrbitJoinError('server-error', 'Join superseded');
    if (!sessionPlaylistId) throw new OrbitJoinError('not-found', `Session ${sid} not found on server`);

    const state = await readOrbitState(sessionPlaylistId, serverId);
    if (!orbitBindingRevisionIsCurrent(joinRevision)) throw new OrbitJoinError('server-error', 'Join superseded');
    if (!state)         throw new OrbitJoinError('not-found', `Session ${sid} has no valid state`);
    if (state.ended)    throw new OrbitJoinError('ended',     `Session ${sid} has ended`);

    // 2) Gate: not kicked, not full. Note: host isn't in `participants` itself,
    //    so `maxUsers` counts guests only.
    if (state.kicked.includes(username)) {
      throw new OrbitJoinError('kicked', `You were removed from session ${sid}`);
    }
    const alreadyInside = state.participants.some(p => p.user === username);
    if (!alreadyInside && state.participants.length >= state.maxUsers) {
      throw new OrbitJoinError('full', `Session ${sid} is full (${state.maxUsers}/${state.maxUsers})`);
    }

    // 3) Create our outbox + first heartbeat.
    const outboxName = orbitOutboxPlaylistName(sid, username);
    // Guard against a stale outbox from a previous abandoned join attempt —
    // if one exists under the same name, reuse its id instead of creating
    // a duplicate (Navidrome allows duplicate names but it'd leak).
    // A *transient* getPlaylists failure must not make us create a duplicate
    // outbox — distinguish "lookup failed" (undefined) from "genuinely absent"
    // (null) and retry only on failure before falling back to create.
    const lookupOutbox = async () => {
      try {
        return (await getPlaylistsForServer(serverId, true)).find(p => p.name === outboxName) ?? null;
      } catch {
        return undefined;
      }
    };
    let existing = await lookupOutbox();
    if (existing === undefined) existing = await lookupOutbox();
    if (!orbitBindingRevisionIsCurrent(joinRevision)) throw new OrbitJoinError('server-error', 'Join superseded');
    if (existing) {
      outboxPlaylistId = existing.id;
    } else {
      const outbox = await createPlaylist(outboxName, undefined, serverId);
      outboxPlaylistId = outbox.id;
    }
    await writeOrbitHeartbeat(outboxPlaylistId, outboxName, serverId);
    if (!orbitBindingRevisionIsCurrent(joinRevision)) throw new OrbitJoinError('server-error', 'Join superseded');

    // 4) Bind the local store. The host's next poll will register us in
    //    `participants` — we don't self-mutate the canonical state.
    useOrbitStore.setState({
      role: 'guest',
      serverId,
      bindingRevision: joinRevision + 1,
      sessionId: sid,
      sessionPlaylistId,
      outboxPlaylistId,
      phase: 'active',
      state,
      errorMessage: null,
      joinedAt: Date.now(),
    });

    return state;
  } catch (err) {
    // Best-effort cleanup.
    if (outboxPlaylistId) { try { await deletePlaylist(outboxPlaylistId, serverId); } catch { /* ignore */ } }
    if (orbitBindingRevisionIsCurrent(joinRevision)) useOrbitStore.getState().setPhase('idle');
    throw err;
  }
}

/**
 * Guest: leave a session voluntarily.
 *
 * Deletes our outbox (so the host stops counting us after its next sweep)
 * and resets the local store. Best-effort on each step. Does NOT touch the
 * canonical session playlist — that's the host's property.
 */
export async function leaveOrbitSession(): Promise<void> {
  const { role, serverId, bindingRevision, outboxPlaylistId } = useOrbitStore.getState();
  if (role !== 'guest') return;
  if (!serverId) { useOrbitStore.getState().reset(); return; }

  if (outboxPlaylistId) {
    try { await deletePlaylist(outboxPlaylistId, serverId); } catch { /* best-effort */ }
  }

  if (orbitBindingRevisionIsCurrent(bindingRevision)) useOrbitStore.getState().reset();
}

/** Why a guest's suggestion would be blocked, in priority order. `null` means
 *  the suggestion can proceed. */
export type OrbitSuggestGateReason = 'not-guest' | 'muted' | null;

/**
 * Evaluate whether the local guest is allowed to send a new suggestion right
 * now — used by both the UI (to disable buttons / show toasts) and
 * {@link suggestOrbitTrack} as a defensive check.
 */
export function evaluateOrbitSuggestGate(): { allowed: boolean; reason: OrbitSuggestGateReason } {
  const { role, serverId, state } = useOrbitStore.getState();
  if (role !== 'guest' || !serverId || !state) return { allowed: false, reason: 'not-guest' };
  const username = useAuthStore.getState().servers.find(server => server.id === serverId)?.username ?? '';
  if (state.suggestionBlocked?.includes(username)) {
    return { allowed: false, reason: 'muted' };
  }
  return { allowed: true, reason: null };
}

export class OrbitSuggestBlockedError extends Error {
  constructor(public readonly reason: Exclude<OrbitSuggestGateReason, null>) {
    super(`Suggestion blocked: ${reason}`);
    this.name = 'OrbitSuggestBlockedError';
  }
}

/**
 * Guest: suggest a track to the session.
 *
 * Appends the track to our own outbox playlist. The host's next sweep will
 * consume it and publish the authoritative queue update in the state blob.
 * No state mutation here — the guest never touches canonical state.
 */
export async function suggestOrbitTrack(trackId: string, trackServerId?: string): Promise<void> {
  const gate = evaluateOrbitSuggestGate();
  if (!gate.allowed && gate.reason && gate.reason !== 'not-guest') {
    throw new OrbitSuggestBlockedError(gate.reason);
  }
  const {
    role,
    serverId,
    bindingRevision,
    outboxPlaylistId,
    sessionId,
    sessionPlaylistId,
  } = useOrbitStore.getState();
  if (role !== 'guest') throw new Error('Not joined to a session as a guest');
  if (!serverId || !outboxPlaylistId || !sessionId || !sessionPlaylistId) throw new Error('No outbox bound');
  if (!orbitActionServerMatches(
    serverId,
    trackServerId,
    useAuthStore.getState().activeServerId,
  )) {
    throw new Error('Track belongs to another server');
  }

  await ensureTrackInOutbox(outboxPlaylistId, trackId, serverId);
  if (!orbitBindingIsCurrent({
    bindingRevision,
    role: 'guest',
    serverId,
    sessionPlaylistId,
  })) return;

  // Record the suggestion locally so the UI can surface it as "waiting on
  // host" until the host's next sweep merges it into the shared queue.
  // Drained by the guest tick's reconcilePendingSuggestions call; tracked for
  // lost-update re-send by notePendingSuggestion.
  useOrbitStore.getState().addPendingSuggestion(trackId);
  notePendingSuggestion(trackId);
}

/**
 * Guest: suggest several tracks, one after another (each one reads and then
 * appends to the outbox playlist, so in parallel they would overwrite each
 * other), with one toast for the batch. Stops at the first refusal.
 */
export async function suggestOrbitTracks(tracks: ReadonlyArray<{ id: string; serverId?: string }>): Promise<void> {
  try {
    for (const track of tracks) await suggestOrbitTrack(track.id, track.serverId);
    showToast(i18n.t('orbit.ctxSuggestedToast'), 2200, 'info');
  } catch (err) {
    if (err instanceof OrbitSuggestBlockedError && err.reason === 'muted') {
      showToast(i18n.t('orbit.suggestBlockedMuted'), 3500, 'error');
    } else {
      showToast(i18n.t('orbit.ctxSuggestFailed'), 3000, 'error');
    }
  }
}

/**
 * Append a track to an outbox playlist unless it's already there. Subsonic's
 * playlist update replaces the song list wholesale on sweep, so we read the
 * current server list before append. A no-op when the track is already present
 * means the host already cleared + recorded it (lost-update re-send path).
 */
export async function ensureTrackInOutbox(
  outboxPlaylistId: string,
  trackId: string,
  requestedServerId?: string,
): Promise<void> {
  const serverId = requestedServerId ?? useOrbitStore.getState().serverId;
  if (!serverId) throw new Error('Orbit server unavailable');
  const { songs } = await getPlaylistForServer(serverId, outboxPlaylistId);
  const ids = songs.map(s => s.id);
  if (ids.includes(trackId)) return;
  await addSongsToPlaylist(outboxPlaylistId, [trackId], serverId);
  usePlaylistMembershipStore.getState().setPlaylistSongIds(outboxPlaylistId, [...ids, trackId], serverId);
}

/**
 * Host: accept a guest suggestion and route it into the live play queue.
 * No-op outside host role. Uses the shared `mergedSuggestionKeys` store
 * slot so the tick doesn't re-process the same item.
 */
export async function approveOrbitSuggestion(q: OrbitQueueItem): Promise<void> {
  const store = useOrbitStore.getState();
  if (store.role !== 'host' || !store.state) return;
  if (!store.serverId || !store.sessionPlaylistId) return;
  const binding = {
    bindingRevision: store.bindingRevision,
    role: 'host' as const,
    serverId: store.serverId,
    sessionPlaylistId: store.sessionPlaylistId,
  };
  try {
    const song = await getSongForServer(store.serverId, q.trackId);
    if (!orbitBindingIsCurrent(binding)) return;
    if (!song) return;
    const track = songToTrack(song);
    usePlayerStore.getState().enqueue([track]);
    store.addMergedSuggestion(suggestionKey(q));
  } catch { /* silent */ }
}

/**
 * Host: reject a guest suggestion. It stays in `OrbitState.queue` as
 * history but is filtered out of the approval UI and the merge tick.
 */
export function declineOrbitSuggestion(q: OrbitQueueItem): void {
  const store = useOrbitStore.getState();
  if (store.role !== 'host') return;
  store.addDeclinedSuggestion(suggestionKey(q));
}
