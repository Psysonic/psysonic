// In-memory cache with a TTL per entry and a cap on the entry count.
// Writing a key moves it to the newest position; the oldest entries are evicted first.

export interface BoundedTtlCache<T> {
  get(key: string): T | null;
  set(key: string, value: T): void;
  clear(): void;
}

export function createBoundedTtlCache<T>(ttlMs: number, maxEntries: number): BoundedTtlCache<T> {
  const map = new Map<string, { value: T; savedAt: number }>();
  return {
    get(key) {
      const entry = map.get(key);
      if (!entry) return null;
      if (Date.now() - entry.savedAt > ttlMs) {
        map.delete(key);
        return null;
      }
      return entry.value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, { value, savedAt: Date.now() });
      while (map.size > maxEntries) {
        const oldestKey = map.keys().next().value as string | undefined;
        if (oldestKey === undefined) break;
        map.delete(oldestKey);
      }
    },
    clear() {
      map.clear();
    },
  };
}
