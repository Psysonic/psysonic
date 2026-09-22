import type { QueueItemRef } from '@/lib/media/trackTypes';

/**
 * Drag data for a queue row. `index` is the grabbed row and stays on every
 * drag, because the drag ghost and the mini player read only that. A block
 * drag adds `indices`, the absolute positions of every entry moved together.
 */
export function buildQueueReorderData(
  index: number,
  block: readonly QueueItemRef[] | null,
  queueItems: readonly QueueItemRef[],
): string {
  if (block && block.length > 1) {
    const positions = new Map(queueItems.map((ref, i) => [ref, i] as const));
    const indices = block
      .map(ref => positions.get(ref))
      .filter((i): i is number => i !== undefined)
      .sort((a, b) => a - b);
    if (indices.length > 1) return JSON.stringify({ type: 'queue_reorder', index, indices });
  }
  return JSON.stringify({ type: 'queue_reorder', index });
}

/** The rows a queue drag carries: the whole block when there is one, otherwise the grabbed row. */
export function queueReorderIndices(parsed: { index?: unknown; indices?: unknown }): number[] {
  if (Array.isArray(parsed.indices)) {
    const block = parsed.indices.filter((i): i is number => Number.isInteger(i));
    if (block.length > 0) return block;
  }
  return typeof parsed.index === 'number' ? [parsed.index] : [];
}
