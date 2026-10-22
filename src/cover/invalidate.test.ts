import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onInvoke } from '@/test/mocks/tauri';
import { invalidateCoverEntity } from './invalidate';
import { forgetDiskSrcPrefix } from './diskSrcCache';
import { invalidateCacheKey } from './imageCache';
import type { CoverArtRef } from './types';

vi.mock('./diskSrcCache', async importOriginal => ({
  ...(await importOriginal<typeof import('./diskSrcCache')>()),
  forgetDiskSrcPrefix: vi.fn(),
}));
vi.mock('./imageCache', async importOriginal => ({
  ...(await importOriginal<typeof import('./imageCache')>()),
  invalidateCacheKey: vi.fn(async () => undefined),
}));

const ref: CoverArtRef = {
  cacheKind: 'artist',
  cacheEntityId: 'ar-1',
  fetchCoverArtId: 'ar-1',
  serverScope: {
    kind: 'server',
    serverId: 'srv-1',
    url: 'https://music.example.test',
    username: 'tester',
    password: 'secret',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('invalidateCoverEntity', () => {
  it('purges the disk tiers, the disk-src entries and every tier blob of the cover', async () => {
    const purge = vi.fn(() => 5);
    onInvoke('cover_cache_invalidate_entity', purge);

    await invalidateCoverEntity(ref);

    expect(purge).toHaveBeenCalledWith({
      serverIndexKey: 'music.example.test',
      cacheKind: 'artist',
      cacheEntityId: 'ar-1',
    });
    expect(forgetDiskSrcPrefix).toHaveBeenCalledWith(ref);
    expect(vi.mocked(invalidateCacheKey).mock.calls.map(([key]) => key).sort()).toEqual(
      [64, 128, 256, 512, 800, 2000]
        .map(tier => `music.example.test:cover:artist:ar-1:${tier}`)
        .sort(),
    );
  });

  it('keeps the in-memory caches when the disk purge fails', async () => {
    onInvoke('cover_cache_invalidate_entity', () => {
      throw new Error('disk busy');
    });

    await expect(invalidateCoverEntity(ref)).rejects.toThrow('disk busy');
    expect(forgetDiskSrcPrefix).not.toHaveBeenCalled();
    expect(invalidateCacheKey).not.toHaveBeenCalled();
  });
});
