import { useSyncExternalStore } from 'react';

let revision = 0;
const listeners = new Set<() => void>();

export function notifyFavoritesChanged(): void {
  revision += 1;
  listeners.forEach(listener => listener());
}

export function useFavoritesRevision(): number {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => revision,
    () => 0,
  );
}
