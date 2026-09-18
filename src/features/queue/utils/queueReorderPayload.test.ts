import { describe, expect, it } from 'vitest';
import type { QueueItemRef } from '@/lib/media/trackTypes';
import { buildQueueReorderData, queueReorderIndices } from './queueReorderPayload';

function queue(...ids: string[]): QueueItemRef[] {
  return ids.map(trackId => ({ serverId: 'srv', trackId }));
}

describe('buildQueueReorderData', () => {
  it('carries only the grabbed row without a block', () => {
    expect(JSON.parse(buildQueueReorderData(2, null, queue('a', 'b', 'c')))).toEqual({
      type: 'queue_reorder',
      index: 2,
    });
  });

  it('carries every block entry by its current position, sorted', () => {
    const items = queue('a', 'dup', 'b', 'dup');
    const data = JSON.parse(buildQueueReorderData(3, [items[3]!, items[0]!], items));
    expect(data).toEqual({ type: 'queue_reorder', index: 3, indices: [0, 3] });
  });

  it('falls back to the grabbed row when the block is gone from the queue', () => {
    const items = queue('a', 'b');
    const stale = queue('x', 'y');
    expect(JSON.parse(buildQueueReorderData(1, stale, items))).toEqual({ type: 'queue_reorder', index: 1 });
  });
});

describe('queueReorderIndices', () => {
  it('prefers the block, then the grabbed row', () => {
    expect(queueReorderIndices({ index: 1, indices: [1, 4] })).toEqual([1, 4]);
    expect(queueReorderIndices({ index: 1, indices: [] })).toEqual([1]);
    expect(queueReorderIndices({ index: 2 })).toEqual([2]);
  });

  it('returns nothing for data without a usable row', () => {
    expect(queueReorderIndices({})).toEqual([]);
    expect(queueReorderIndices({ indices: ['x'] })).toEqual([]);
  });
});
