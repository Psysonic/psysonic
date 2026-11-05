import { createPlaylist, deletePlaylist } from '@/lib/api/subsonicPlaylists';
import { getSongForServer } from '@/lib/api/subsonicLibrary';
import { songToTrack } from '@/lib/media/songToTrack';
import { useAuthStore } from '@/store/authStore';
import { deriveLibraryBrowseServerIdsWithFallback } from '@/lib/library/libraryBrowseScope';
import { switchActiveServer } from '@/utils/server/switchActiveServer';
import {
  orbitBindingIsCurrent,
  orbitBindingRevisionIsCurrent,
  type OrbitHostScopeSnapshot,
  useOrbitStore,
} from '@/features/orbit/store/orbitStore';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import {
  makeInitialOrbitState,
  orbitOutboxPlaylistName,
  orbitSessionPlaylistName,
  ORBIT_DEFAULT_MAX_USERS,
  ORBIT_DEFAULT_SETTINGS,
  type OrbitQueueItem,
  type OrbitSettings,
  type OrbitState,
} from '@/features/orbit/api/orbit';
import { generateSessionId } from '@/features/orbit/utils/helpers';
import { readOrbitTransitionSettings } from '@/features/orbit/utils/transitions';
import { writeOrbitHeartbeat, writeOrbitState } from '@/features/orbit/utils/remote';
import { orbitActionServerMatches } from '@/features/orbit/utils/orbitServerScope';

export interface StartOrbitArgs {
  /** Human-readable name the host chose. */
  name: string;
  /** Max participants (defaults to `ORBIT_DEFAULT_MAX_USERS`). */
  maxUsers?: number;
  /**
   * Pre-generated session id. Lets the caller (e.g. the start modal) show a
   * stable share-link *before* the session is actually created. Falls back
   * to a fresh id when omitted.
   */
  sid?: string;
  /** Captured server profile shown in the start modal. */
  serverId?: string;
  /** Start with an empty queue instead of retaining the chosen server's tracks. */
  clearQueue?: boolean;
  /**
   * Whether the session starts with the automatic reshuffle on. Omitted =
   * `ORBIT_DEFAULT_SETTINGS.autoShuffle`. The host can still flip it in the
   * session settings.
   */
  autoShuffle?: boolean;
}

function restoreHostScopeSnapshot(snapshot: OrbitHostScopeSnapshot | null): void {
  if (!snapshot) return;
  const auth = useAuthStore.getState();
  const activeServerId = snapshot.activeServerId
    && auth.servers.some(server => server.id === snapshot.activeServerId)
    ? snapshot.activeServerId
    : auth.activeServerId;
  const libraryBrowseServerIds = deriveLibraryBrowseServerIdsWithFallback({
    servers: auth.servers,
    activeServerId,
    libraryBrowseServerIds: snapshot.libraryBrowseServerIds,
  });
  const activeChanged = activeServerId !== auth.activeServerId;
  const scopeChanged = libraryBrowseServerIds.length !== auth.libraryBrowseServerIds.length
    || libraryBrowseServerIds.some((id, index) => id !== auth.libraryBrowseServerIds[index]);
  if (!activeChanged && !scopeChanged) return;

  // Every saved server already has a live HTTP context. Restore the previous
  // pointers synchronously so normal teardown and app exit do not wait on a probe.
  useAuthStore.setState(state => ({
    ...(activeChanged ? {
      activeServerId,
      musicFolders: activeServerId ? state.musicFoldersByServer[activeServerId] ?? [] : [],
    } : {}),
    ...(scopeChanged ? {
      libraryBrowseServerIds,
      libraryBrowseScopeVersion: state.libraryBrowseScopeVersion + 1,
    } : {}),
  }));
}

/**
 * Host: create a new session.
 *
 * Creates both the canonical session playlist and the host's own outbox,
 * seeds the state blob + heartbeat, binds the store, sets phase to `active`.
 *
 * Throws if the Navidrome server isn't available or lacks a logged-in user.
 * On throw the store is left in the pre-call state — nothing partially bound.
 */
export async function startOrbitSession(args: StartOrbitArgs): Promise<OrbitState> {
  const auth = useAuthStore.getState();
  const server = args.serverId
    ? auth.servers.find(candidate => candidate.id === args.serverId)
    : auth.getActiveServer();
  const username = server?.username;
  if (!server || !username) throw new Error('No active Navidrome server / user');
  const serverId = server.id;

  const store = useOrbitStore.getState();
  if (store.phase !== 'idle') {
    throw new Error(`Cannot start while phase is ${store.phase}`);
  }
  const startRevision = store.bindingRevision;
  const hostScopeSnapshot: OrbitHostScopeSnapshot = {
    activeServerId: auth.activeServerId,
    libraryBrowseServerIds: [...auth.libraryBrowseServerIds],
  };

  store.setPhase('starting');

  let sessionPlaylistId: string | null = null;
  let outboxPlaylistId:  string | null = null;
  try {
    if (auth.activeServerId !== serverId) {
      const switched = await switchActiveServer(server);
      if (!orbitBindingRevisionIsCurrent(startRevision)) throw new Error('Orbit start superseded');
      if (!switched) throw new Error('Could not connect to the selected Orbit server');
    }
    useAuthStore.getState().setLibraryBrowseServerExclusive(serverId);
    if (args.clearQueue) usePlayerStore.getState().clearQueue();
    else usePlayerStore.getState().retainQueueForServer(serverId);

    const sid = args.sid ?? generateSessionId();
    const sessionName = orbitSessionPlaylistName(sid);
    const outboxName  = orbitOutboxPlaylistName(sid, username);

    // Create both playlists. Navidrome's createPlaylist returns the created
    // object with its new id.
    const sessionPlaylist = await createPlaylist(sessionName, undefined, serverId);
    sessionPlaylistId = sessionPlaylist.id;
    if (!orbitBindingRevisionIsCurrent(startRevision)) throw new Error('Orbit start superseded');

    const outboxPlaylist = await createPlaylist(outboxName, undefined, serverId);
    outboxPlaylistId = outboxPlaylist.id;
    if (!orbitBindingRevisionIsCurrent(startRevision)) throw new Error('Orbit start superseded');

    // Seed state blob + heartbeat. We use updatePlaylistMeta instead of
    // separate create-with-comment because Subsonic's createPlaylist doesn't
    // take a comment argument.
    const state = makeInitialOrbitState({
      sid,
      host: username,
      name: args.name,
      maxUsers: args.maxUsers ?? ORBIT_DEFAULT_MAX_USERS,
    });
    // Seed the host's current track-transition prefs so a guest joining
    // immediately adopts them from the very first blob; the host tick keeps
    // them fresh thereafter.
    state.settings = {
      ...(state.settings ?? ORBIT_DEFAULT_SETTINGS),
      ...(args.autoShuffle !== undefined ? { autoShuffle: args.autoShuffle } : {}),
      transitions: readOrbitTransitionSettings(),
    };
    await writeOrbitState(sessionPlaylistId, state, serverId);
    await writeOrbitHeartbeat(outboxPlaylistId, outboxName, serverId);
    if (!orbitBindingRevisionIsCurrent(startRevision)) throw new Error('Orbit start superseded');

    // Bind local store — session is now live.
    useOrbitStore.setState({
      role: 'host',
      serverId,
      hostScopeSnapshot,
      bindingRevision: startRevision + 1,
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
    // Best-effort cleanup of anything we managed to create before the failure.
    if (outboxPlaylistId)  { try { await deletePlaylist(outboxPlaylistId, serverId); }  catch { /* ignore */ } }
    if (sessionPlaylistId) { try { await deletePlaylist(sessionPlaylistId, serverId); } catch { /* ignore */ } }
    if (orbitBindingRevisionIsCurrent(startRevision)) {
      restoreHostScopeSnapshot(hostScopeSnapshot);
      useOrbitStore.getState().setPhase('idle');
    }
    throw err;
  }
}

/**
 * Host: end the session cleanly.
 *
 * Writes `ended: true` first so any poll-in-progress from a guest sees the
 * signal, then deletes both playlists and resets the local store. Each step
 * is best-effort; if something's already gone server-side we still zero out
 * local state so the UI returns to idle.
 */
export async function endOrbitSession(): Promise<void> {
  const {
    role,
    state,
    serverId,
    hostScopeSnapshot,
    bindingRevision,
    sessionPlaylistId,
    outboxPlaylistId,
  } = useOrbitStore.getState();
  if (role !== 'host') return;
  if (!serverId) {
    restoreHostScopeSnapshot(hostScopeSnapshot);
    useOrbitStore.getState().reset();
    return;
  }

  // 1) Flip `ended` so guests notice on their next poll even if deletion fails.
  if (sessionPlaylistId && state) {
    try {
      await writeOrbitState(sessionPlaylistId, { ...state, ended: true }, serverId);
    } catch { /* best-effort */ }
  }

  // 2) Delete both playlists. Order: outbox first — if session delete fails,
  // a stale session playlist with ended=true is fine; a stale outbox without
  // a session is noise.
  if (outboxPlaylistId)  { try { await deletePlaylist(outboxPlaylistId, serverId); }  catch { /* best-effort */ } }
  if (sessionPlaylistId) { try { await deletePlaylist(sessionPlaylistId, serverId); } catch { /* best-effort */ } }

  // 3) Local teardown.
  if (orbitBindingRevisionIsCurrent(bindingRevision)) {
    restoreHostScopeSnapshot(hostScopeSnapshot);
    useOrbitStore.getState().reset();
  }
}

/**
 * Host-only: force an immediate shuffle of the upcoming play queue, bump
 * `lastShuffle` so the automatic 15-min timer resets, and push the new
 * state to Navidrome. Ignores the `autoShuffle` setting — this is an
 * explicit user action.
 */
export async function triggerOrbitShuffleNow(): Promise<void> {
  const store = useOrbitStore.getState();
  if (store.role !== 'host' || !store.serverId || !store.state || !store.sessionPlaylistId) return;

  // 1) Shuffle the host's real play queue (upcoming only).
  usePlayerStore.getState().shuffleUpcomingQueue();

  // 2) Shuffle the OrbitState.queue (guest-facing suggestion history) +
  //    bump lastShuffle so the auto-shuffle timer restarts.
  const now = Date.now();
  const shuffled = store.state.queue.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const next: OrbitState = { ...store.state, queue: shuffled, lastShuffle: now };
  store.setState(next);
  try { await writeOrbitState(store.sessionPlaylistId, next, store.serverId); }
  catch { /* best-effort; next host-tick will push */ }
}

/**
 * Host-only: update the session settings and immediately push to Navidrome
 * so guests see the change on their next poll. No-op unless the caller is
 * the current host with an active session.
 */
export async function updateOrbitSettings(patch: Partial<OrbitSettings>): Promise<void> {
  const store = useOrbitStore.getState();
  if (store.role !== 'host' || !store.serverId || !store.state || !store.sessionPlaylistId) return;
  // Fall back to the canonical defaults (not a hand-rolled literal) for
  // legacy sessions whose blob predates the settings field — otherwise
  // patching one field on a settings-less session would silently flip
  // autoApprove on, since the old literal had it true while
  // ORBIT_DEFAULT_SETTINGS (the popover's source of truth) has it false.
  const mergedSettings: OrbitSettings = {
    ...(store.state.settings ?? ORBIT_DEFAULT_SETTINGS),
    ...patch,
  };
  const next: OrbitState = { ...store.state, settings: mergedSettings };
  store.setState(next);
  try { await writeOrbitState(store.sessionPlaylistId, next, store.serverId); }
  catch { /* best-effort; next host-tick will push the current state anyway */ }
}

/**
 * Host: add a track to the active Orbit session directly, skipping the
 * outbox/approval loop guests go through. The track lands in the host's
 * own play queue immediately and is attributed to the host in the
 * session's suggestion history. Host-authored queue items are filtered
 * out of the tick-merge pipeline so the host-tick doesn't re-insert the
 * same track once it notices the new entry in `OrbitState.queue`.
 */
export async function hostEnqueueToOrbit(trackId: string, trackServerId?: string): Promise<void> {
  const store = useOrbitStore.getState();
  if (store.role !== 'host' || !store.state || !store.sessionPlaylistId) {
    throw new Error('Not hosting an active Orbit session');
  }

  if (!store.serverId) throw new Error('Orbit server unavailable');
  const binding = {
    bindingRevision: store.bindingRevision,
    role: 'host' as const,
    serverId: store.serverId,
    sessionPlaylistId: store.sessionPlaylistId,
  };
  if (!orbitActionServerMatches(
    store.serverId,
    trackServerId,
    useAuthStore.getState().activeServerId,
  )) {
    throw new Error('Track belongs to another server');
  }
  const song = await getSongForServer(store.serverId, trackId);
  if (!orbitBindingIsCurrent(binding)) throw new Error('Orbit session changed');
  if (!song) throw new Error('Track not found');
  const track = songToTrack(song);

  usePlayerStore.getState().enqueue([track]);

  const current = useOrbitStore.getState();
  if (!current.state || !orbitBindingIsCurrent(binding)) throw new Error('Orbit session changed');
  const item: OrbitQueueItem = { trackId, addedBy: current.state.host, addedAt: Date.now() };
  const next: OrbitState = { ...current.state, queue: [...current.state.queue, item] };
  if (!orbitBindingIsCurrent(binding)) throw new Error('Orbit session changed');
  current.setState(next);
  try { await writeOrbitState(store.sessionPlaylistId, next, store.serverId); }
  catch { /* best-effort; next host-tick will push the merged state anyway */ }
}
