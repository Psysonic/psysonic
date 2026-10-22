/**
 * Fires when the current track played to its end and the queue moves on by
 * itself (ended, gapless switch, crossfade hand-off) — never on a skip, a seek
 * or a new list. Listeners read the player store, which still holds the track
 * that just finished.
 */
type NaturalTrackEndListener = () => void;

const listeners = new Set<NaturalTrackEndListener>();

export function onNaturalTrackEnd(listener: NaturalTrackEndListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitNaturalTrackEnd(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.error('[psysonic] natural track end listener failed:', err);
    }
  }
}
