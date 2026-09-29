import { setRating, star, unstar } from '@/lib/api/subsonicStarRating';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { patchCachedTrack } from '@/features/playback/store/queueTrackResolver';
import { onActiveServerBecameReachable } from '@/lib/network/activeServerReachability';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';

/**
 * F4 — pending-sync for **song** star + rating (spec §6.5 / R7-18).
 *
 * The player-store override maps (`starredOverrides` / `userRatingOverrides`)
 * are *session-only* client truth that every list view merges over its
 * one-shot-fetched state:
 *
 * 1. Set the override optimistically (instant UI).
 * 2. Retry the Subsonic API (`star` / `unstar` / `setRating`) with exponential
 *    backoff; flush immediately when the active server becomes reachable again
 *    (`onActiveServerBecameReachable`) or on window focus.
 * 3. On success: KEEP the override — list views read it — and patch the
 *    in-memory `Track`. F3 index patch-on-use runs in the API layer. Stars and
 *    ratings behave the same here; a rating used to be dropped on success,
 *    which made a rating set from the context menu fall back to the value the
 *    page was loaded with.
 * 4. On app restart before success: the pending change is lost — acceptable,
 *    overrides are not persisted.
 *
 * **No rollback on the first network error** (this replaces the per-component
 * star rollback). v1 routes **songs only**; album/artist stay on their existing
 * paths.
 */

type Task =
  | { kind: 'star'; id: string; starred: boolean; serverId?: string; overrideKey: string }
  | { kind: 'rating'; id: string; rating: number; serverId?: string; overrideKey: string };

const pending = new Map<string, Task>(); // key `${kind}:${id}` — latest wins
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const attempts = new Map<string, number>();
const MAX_BACKOFF_MS = 30_000;
/**
 * Smallest gap between two first attempts. Rating a whole selection queues one
 * task per track, and firing them together would put the entire selection on
 * the wire at once — the shape of load a small self-hosted server handles
 * worst. A single click still goes out immediately; only a burst is spread.
 * Retries keep their own backoff.
 */
const MIN_DISPATCH_SPACING_MS = 80;
let nextDispatchAt = 0;
let listenersArmed = false;

/** Delay for the next first attempt, spacing bursts without delaying a lone click. */
function nextDispatchDelay(): number {
  const now = Date.now();
  const at = Math.max(now, nextDispatchAt);
  nextDispatchAt = at + MIN_DISPATCH_SPACING_MS;
  return at - now;
}

const keyOf = (t: Task) =>
  `${t.kind}:${t.serverId ?? ''}:${t.id}`;

function armListeners(): void {
  if (listenersArmed || typeof window === 'undefined') return;
  listenersArmed = true;
  const flushAll = () => {
    for (const k of pending.keys()) schedule(k, nextDispatchDelay());
  };
  window.addEventListener('focus', flushAll);
  onActiveServerBecameReachable(flushAll);
}

function schedule(k: string, delayMs: number): void {
  const existing = timers.get(k);
  if (existing) clearTimeout(existing);
  timers.set(
    k,
    setTimeout(() => {
      void run(k);
    }, delayMs),
  );
}

async function run(k: string): Promise<void> {
  timers.delete(k);
  const task = pending.get(k);
  if (!task) return;
  try {
    if (task.kind === 'star') {
      const meta = task.serverId ? { serverId: task.serverId } : undefined;
      if (task.starred) await star(task.id, 'song', meta);
      else await unstar(task.id, 'song', meta);
      onStarSuccess(task);
    } else {
      if (task.serverId) await setRating(task.id, task.rating, { serverId: task.serverId });
      else await setRating(task.id, task.rating);
      onRatingSuccess(task);
    }
    // Only retire the entry if a newer toggle hasn't superseded it mid-flight.
    if (pending.get(k) === task) {
      pending.delete(k);
      attempts.delete(k);
    }
  } catch {
    if (pending.get(k) !== task) return; // superseded — the newer task self-schedules
    const n = (attempts.get(k) ?? 0) + 1;
    attempts.set(k, n);
    schedule(k, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (n - 1)));
  }
}

function onStarSuccess(task: Extract<Task, { kind: 'star' }>): void {
  const starredVal = task.starred ? new Date().toISOString() : undefined;
  // Keep the override — list views merge it (step 3 atop this file).
  usePlayerStore.setState(s => ({
    currentTrack:
      s.currentTrack?.id === task.id
        && (!task.serverId || !s.currentTrack.serverId || s.currentTrack.serverId === task.serverId)
        ? { ...s.currentTrack, starred: starredVal }
        : s.currentTrack,
  }));
  // Thin-state: the queue's copy lives in the resolver cache. Patch it in place
  // to the synced value rather than dropping it — a dropped entry would blank the
  // visible queue row to a "…" placeholder until the next window re-resolve.
  patchCachedTrack(task.id, { starred: starredVal }, task.serverId ?? '');
}

function onRatingSuccess(task: Extract<Task, { kind: 'rating' }>): void {
  const rating = usePlayerStore.getState().userRatingOverrides[task.overrideKey];
  // KEEP the override, exactly like a star (step 3 atop this file). The rows a
  // list renders still carry the rating the server sent when the page loaded,
  // and the per-page "freshly rated" maps are only filled by a click on the row
  // itself — a rating from the context menu reaches neither. Dropping it here
  // made such a rating appear and then fall back until the page was re-entered.
  // Patch the cached queue track in place (see onStarSuccess) so the row keeps
  // its title and shows the synced rating without flashing a placeholder.
  if (rating !== undefined) {
    patchCachedTrack(task.id, { userRating: rating }, task.serverId ?? '');
  }
}

/** Optimistically (un)star a song and sync it to the server with retry. */
export function queueSongStar(
  id: string,
  starred: boolean,
  serverId?: string,
  options?: { scopedOverride?: boolean },
): void {
  const scopedOverride = options?.scopedOverride ?? Boolean(serverId);
  const overrideKey = scopedOverride ? ownedEntityKey({ id, serverId }) : id;
  usePlayerStore.getState().setStarredOverride(overrideKey, starred);
  const t: Task = { kind: 'star', id, starred, serverId, overrideKey };
  const k = keyOf(t);
  pending.set(k, t);
  attempts.delete(k);
  armListeners();
  schedule(k, nextDispatchDelay());
}

/** Optimistically rate a song and sync it to the server with retry. */
export function queueSongRating(
  id: string,
  rating: number,
  serverId?: string,
  options?: { scopedOverride?: boolean },
): void {
  const scopedOverride = options?.scopedOverride ?? Boolean(serverId);
  const overrideKey = scopedOverride ? ownedEntityKey({ id, serverId }) : id;
  usePlayerStore.getState().setUserRatingOverride(overrideKey, rating);
  const t: Task = { kind: 'rating', id, rating, serverId, overrideKey };
  const k = keyOf(t);
  pending.set(k, t);
  attempts.delete(k);
  armListeners();
  schedule(k, nextDispatchDelay());
}

/** Test-only: clear all pending state + timers. */
export function _resetPendingStarSyncForTest(): void {
  pending.clear();
  attempts.clear();
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  nextDispatchAt = 0;
}
