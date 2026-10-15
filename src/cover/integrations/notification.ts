import { coverCacheEnsure } from '@/lib/api/coverCache';
import type { CoverArtRef } from '../types';
import { coverDiskPath } from './diskPath';

/**
 * Desktop notification image — the cached 256px cover on disk, or null when it
 * cannot be cached. No network fallback: notification daemons only read files.
 */
export async function coverArtPathForNotification(ref: CoverArtRef): Promise<string | null> {
  try {
    const result = await coverCacheEnsure(ref, 256);
    if (result.hit && result.path) return coverDiskPath(result.path);
  } catch {
    // A notification without an image beats none at all.
  }
  return null;
}
