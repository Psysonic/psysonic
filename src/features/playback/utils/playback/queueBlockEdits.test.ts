import { describe, expect, it } from 'vitest';
import type { QueueItemRef, Track } from '@/lib/media/trackTypes';
import { makeTrack } from '@/test/helpers/factories';
import { planQueueItemsMove, planQueueItemsRemoval } from './queueBlockEdits';

function queue(...ids: string[]): QueueItemRef[] {
  return ids.map(trackId => ({ serverId: 'srv', trackId }));
}

const ids = (items: readonly QueueItemRef[] | undefined) => items?.map(ref => ref.trackId);
const playing = (trackId: string): Track => makeTrack({ id: trackId, serverId: 'srv' });

describe('planQueueItemsMove', () => {
  it('lands a row moved down exactly at the gap it was dropped on', () => {
    // Dropped below "c" (the gap before index 3): b belongs between c and d.
    const edit = planQueueItemsMove(queue('a', 'b', 'c', 'd'), 0, null, [1], 3);
    expect(ids(edit?.items)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('lands a row moved up exactly at the gap it was dropped on', () => {
    const edit = planQueueItemsMove(queue('a', 'b', 'c', 'd'), 0, null, [3], 1);
    expect(ids(edit?.items)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves a scattered block together and keeps its order', () => {
    const edit = planQueueItemsMove(queue('a', 'b', 'c', 'd', 'e', 'f'), 0, null, [4, 1], 6);
    expect(ids(edit?.items)).toEqual(['a', 'c', 'd', 'f', 'b', 'e']);
  });

  it('closes up a scattered block dropped between its own members', () => {
    const edit = planQueueItemsMove(queue('a', 'b', 'c', 'd', 'e'), 0, null, [1, 3], 3);
    expect(ids(edit?.items)).toEqual(['a', 'c', 'b', 'd', 'e']);
  });

  it('returns null when the block would stay where it is', () => {
    expect(planQueueItemsMove(queue('a', 'b', 'c'), 0, null, [1], 1)).toBeNull();
    expect(planQueueItemsMove(queue('a', 'b', 'c'), 0, null, [1], 2)).toBeNull();
    expect(planQueueItemsMove(queue('a', 'b', 'c', 'd'), 0, null, [1, 2], 2)).toBeNull();
  });

  it('ignores indices outside the queue and clamps the gap', () => {
    expect(planQueueItemsMove(queue('a', 'b'), 0, null, [5, -1, 0.5], 0)).toBeNull();
    const edit = planQueueItemsMove(queue('a', 'b', 'c'), 0, null, [0, 9], 99);
    expect(ids(edit?.items)).toEqual(['b', 'c', 'a']);
  });

  it('keeps the cursor on the playing entry', () => {
    const items = queue('a', 'b', 'c', 'd');
    const edit = planQueueItemsMove(items, 1, playing('b'), [2, 3], 0);
    expect(ids(edit?.items)).toEqual(['c', 'd', 'a', 'b']);
    expect(edit?.items[edit.queueIndex]).toBe(items[1]);
  });

  it('keeps the cursor on its entry when nothing is playing', () => {
    const items = queue('a', 'b', 'c');
    const edit = planQueueItemsMove(items, 2, null, [2], 0);
    expect(edit?.items[edit.queueIndex]).toBe(items[2]);
  });
});

describe('planQueueItemsRemoval', () => {
  it('matches entries by identity, so one copy of a repeated track can go', () => {
    const items = queue('dup', 'x', 'dup');
    const edit = planQueueItemsRemoval(items, 1, playing('x'), [items[2]!]);
    expect(edit?.items).toEqual([items[0], items[1]]);
    expect(edit?.items[0]).toBe(items[0]);
  });

  it('keeps the playing entry even when it is asked to go', () => {
    const items = queue('a', 'b', 'c');
    const edit = planQueueItemsRemoval(items, 1, playing('b'), items);
    expect(edit?.items).toEqual([items[1]]);
    expect(edit?.queueIndex).toBe(0);
  });

  it('returns null when nothing matches', () => {
    const items = queue('a', 'b');
    expect(planQueueItemsRemoval(items, 0, null, [{ serverId: 'srv', trackId: 'a' }])).toBeNull();
  });
});
