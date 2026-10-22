import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  coverCacheEnsure: vi.fn(),
}));

vi.mock('@/lib/api/coverCache', () => ({ coverCacheEnsure: hoisted.coverCacheEnsure }));

import { coverArtPathForNotification } from './notification';
import { coverDiskPath } from './diskPath';
import type { CoverArtRef } from '../types';

const ref: CoverArtRef = {
  cacheKind: 'album',
  cacheEntityId: 'al-1',
  fetchCoverArtId: 'al-1',
  serverScope: { kind: 'playback' },
};

beforeEach(() => {
  hoisted.coverCacheEnsure.mockReset();
});

describe('coverDiskPath', () => {
  it('drops the mtime version an ensure result carries', () => {
    expect(coverDiskPath('/cache/al-1/256.webp|1712345678')).toBe('/cache/al-1/256.webp');
  });

  it('keeps a path without a version, including one with a non-numeric pipe', () => {
    expect(coverDiskPath('/cache/al-1/256.webp')).toBe('/cache/al-1/256.webp');
    expect(coverDiskPath('/cache/a|b/256.webp')).toBe('/cache/a|b/256.webp');
  });
});

describe('coverArtPathForNotification', () => {
  it('returns the cached 256px cover on disk', async () => {
    hoisted.coverCacheEnsure.mockResolvedValue({ hit: true, path: '/cache/al-1/256.webp|42' });

    await expect(coverArtPathForNotification(ref)).resolves.toBe('/cache/al-1/256.webp');
    expect(hoisted.coverCacheEnsure).toHaveBeenCalledWith(ref, 256);
  });

  it('returns null when the cover is not on disk or the cache fails', async () => {
    hoisted.coverCacheEnsure.mockResolvedValueOnce({ hit: false, path: null });
    await expect(coverArtPathForNotification(ref)).resolves.toBeNull();

    hoisted.coverCacheEnsure.mockRejectedValueOnce(new Error('offline'));
    await expect(coverArtPathForNotification(ref)).resolves.toBeNull();
  });
});
