/**
 * The list a queue was started from, when that is more than the tracks it holds.
 * `shuffled` marks a list started in random order, which has no place to resume.
 */
export type QueueSource = {
  kind: 'album' | 'playlist';
  id: string;
  serverId?: string;
  shuffled?: boolean;
};

/**
 * Hands a queue source to the `playTrack` call made inside `start` without
 * widening its positional signature. `runPlayTrack` takes it synchronously on
 * entry; `finally` clears it even when `start` never reaches `playTrack` (an
 * empty list, a guard), so it cannot leak into an unrelated later call.
 */
let pending: QueueSource | null = null;

export function withQueueSource<T>(source: QueueSource, start: () => T): T {
  pending = source;
  try {
    return start();
  } finally {
    pending = null;
  }
}

export function takePendingQueueSource(): QueueSource | null {
  const source = pending;
  pending = null;
  return source;
}
