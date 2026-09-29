import { useEffect, useState } from 'react';

/**
 * Returns true only when `isBuffering` has persisted continuously for `delayMs`.
 * Clears immediately (0 ms) as soon as buffering ends.
 *
 * This prevents the cover-art spinner overlay from flickering during brief
 * in-flight seeks or fast in-memory buffer handoffs.
 */
export function useDebouncedBuffering(isBuffering: boolean, delayMs = 150): boolean {
  const [debounced, setDebounced] = useState(false);
  const [prevIsBuffering, setPrevIsBuffering] = useState(isBuffering);

  if (prevIsBuffering !== isBuffering) {
    setPrevIsBuffering(isBuffering);
    if (!isBuffering) {
      setDebounced(false);
    }
  }

  useEffect(() => {
    if (!isBuffering) return;

    const timer = setTimeout(() => {
      setDebounced(true);
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [isBuffering, delayMs]);

  return isBuffering ? debounced : false;
}
