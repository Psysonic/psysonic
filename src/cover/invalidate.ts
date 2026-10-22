import { coverCacheInvalidateEntity } from '@/lib/api/coverCache';
import { forgetDiskSrcPrefix } from './diskSrcCache';
import { invalidateCacheKey } from './imageCache';
import { coverStorageKeyFromRef } from './storageKeys';
import { COVER_ART_TIERS, type CoverArtRef } from './types';

/**
 * Drop every cached copy of one cover after its art changed on the server
 * (cover-art-pipeline contract §10, e.g. an uploaded artist image): the disk
 * tiers, the in-memory disk-src entries and the blob/IndexedDB entry of every
 * tier. The next ensure downloads the server's new art.
 */
export async function invalidateCoverEntity(ref: CoverArtRef): Promise<void> {
  await coverCacheInvalidateEntity(ref);
  forgetDiskSrcPrefix(ref);
  await Promise.all(
    COVER_ART_TIERS.map(tier => invalidateCacheKey(coverStorageKeyFromRef(ref, tier))),
  );
}
