import { describe, expect, it, vi } from 'vitest';
import {
  isSyncOnlyCatalogChange,
  refetchCatalogWindow,
} from '@/lib/library/browseCatalogSyncRefresh';

function rows(from: number, count: number): { id: string }[] {
  return Array.from({ length: count }, (_, index) => ({ id: `r${from + index}` }));
}

describe('isSyncOnlyCatalogChange', () => {
  it('is true only for the same view at a new sync revision', () => {
    const previous = { viewKey: 'v', syncRevision: 1 };
    expect(isSyncOnlyCatalogChange(previous, 'v', 2)).toBe(true);
    expect(isSyncOnlyCatalogChange(previous, 'v', 1)).toBe(false);
    expect(isSyncOnlyCatalogChange(previous, 'other', 2)).toBe(false);
    expect(isSyncOnlyCatalogChange(null, 'v', 2)).toBe(false);
  });
});

describe('refetchCatalogWindow', () => {
  it('keeps reading until the loaded length is covered', async () => {
    const fetchPage = vi.fn(async (offset: number, size: number, _cursor?: string | null) => ({
      items: rows(offset, size),
      hasMore: true,
      nextCursor: `c${offset + size}`,
    }));

    const result = await refetchCatalogWindow(450, 200, fetchPage);

    expect(result?.items).toHaveLength(600);
    expect(result?.hasMore).toBe(true);
    expect(result?.nextCursor).toBe('c600');
    expect(fetchPage.mock.calls.map(call => [call[0], call[2]])).toEqual([
      [0, undefined],
      [200, 'c200'],
      [400, 'c400'],
    ]);
  });

  it('stops at the end of the catalog', async () => {
    const fetchPage = vi.fn(async () => ({ items: rows(0, 3), hasMore: false }));

    const result = await refetchCatalogWindow(450, 200, fetchPage);

    expect(result?.items).toHaveLength(3);
    expect(result?.hasMore).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('gives up when a page fails', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: rows(0, 200), hasMore: true })
      .mockResolvedValueOnce(null);

    await expect(refetchCatalogWindow(450, 200, fetchPage)).resolves.toBeNull();
  });

  it('stops when a page adds nothing new', async () => {
    const fetchPage = vi.fn(async () => ({ items: rows(0, 200), hasMore: true }));

    const result = await refetchCatalogWindow(450, 200, fetchPage);

    expect(result?.items).toHaveLength(200);
    expect(result?.hasMore).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});
