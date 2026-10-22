/**
 * Persistent shuffle mode — pure helpers and the remembered pre-shuffle order.
 *
 * Turning shuffle on physically reorders the queue (the tracks after the current
 * one) and remembers the order it came from; turning it off puts that order back.
 * The toggle itself lives with the other queue mutations in
 * `queueMutationActions` — it pushes an undo snapshot and syncs the queue to the
 * server like every other mutation, and those modules reach back into the player
 * store. This file stays free of that so it can be imported anywhere.
 *
 * The alternative design — leaving `queueItems` alone and only *playing* in a
 * hidden random order — was rejected deliberately: "what plays next" is derived
 * from the list order in four places (manual next, the gapless successor, the
 * chain preload, the crossfade/AutoDJ plan), the engine is handed the next track
 * ~30 s ahead with no way to take it back, and the server play-queue (and Orbit
 * guests) only ever see the list order.
 */

import type { QueueItemRef } from '@/lib/media/trackTypes';
import {
  queueItemIdentityKey,
  queueTrackIdFromIdentity,
} from '@/features/playback/utils/playback/queueIdentity';

/** Module-level, like the other non-render queue state: the UI never reads it. */
let originalOrder: string[] = [];

export function getShuffleOriginalOrder(): string[] {
  return originalOrder;
}

/**
 * Sets the remembered order. Called when shuffle is switched on, cleared when it
 * is switched off, and seeded from storage on boot — shuffle survives a restart,
 * so the order it can be undone to has to survive with it.
 */
export function setShuffleOriginalOrder(order: string[]): void {
  originalOrder = order;
}

/**
 * Reorders `items` back into `order`, matching by server + track id.
 *
 * Ids can repeat (the same track may sit in the queue twice), so each id consumes
 * one ref at a time rather than filtering. Refs the remembered order does not
 * know about — enqueued, radio-topped-up or auto-added while shuffle was on —
 * keep their relative order and go to the end: they were never part of the
 * original list, so there is no position to restore them to.
 */
export function restoreOriginalOrder(items: QueueItemRef[], order: string[]): QueueItemRef[] {
  const identityPools = new Map<string, QueueItemRef[]>();
  const legacyPools = new Map<string, QueueItemRef[]>();
  for (const ref of items) {
    const identity = queueItemIdentityKey(ref);
    const identityPool = identityPools.get(identity);
    if (identityPool) identityPool.push(ref);
    else identityPools.set(identity, [ref]);

    const legacyPool = legacyPools.get(ref.trackId);
    if (legacyPool) legacyPool.push(ref);
    else legacyPools.set(ref.trackId, [ref]);
  }

  const restored: QueueItemRef[] = [];
  const restoredSet = new Set<QueueItemRef>();
  for (const identity of order) {
    const legacyTrackId = queueTrackIdFromIdentity(identity) ?? identity;
    const pool = identityPools.get(identity) ?? legacyPools.get(legacyTrackId);
    let ref = pool?.shift();
    while (ref && restoredSet.has(ref)) ref = pool?.shift();
    if (ref) restored.push(ref);
    if (ref) restoredSet.add(ref);
  }

  return [...restored, ...items.filter(ref => !restoredSet.has(ref))];
}
