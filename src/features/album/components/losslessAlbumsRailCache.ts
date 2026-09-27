import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';
import { createBoundedTtlCache } from '@/lib/cache/boundedTtlCache';

const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ENTRIES = 8;

export type LosslessRailCacheEntry = {
  albums: SubsonicAlbum[];
  status: 'ready' | 'empty';
};

const cache = createBoundedTtlCache<LosslessRailCacheEntry>(CACHE_TTL_MS, CACHE_MAX_ENTRIES);

export function readLosslessRailCache(key: string): LosslessRailCacheEntry | null {
  return cache.get(key);
}

export function writeLosslessRailCache(key: string, entry: LosslessRailCacheEntry): void {
  cache.set(key, entry);
}

export function resetLosslessRailCacheForTests(): void {
  cache.clear();
}
