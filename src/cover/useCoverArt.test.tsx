import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
}));
vi.mock('./peekQueue', () => ({ coverPeekQueued: vi.fn(async () => true) }));
vi.mock('./ensureQueue', () => ({
  coverEnsureQueued: vi.fn(async () => ({ hit: true, path: '/cache/pl-1/256.webp' })),
  coverEnsureRelease: vi.fn(),
}));
vi.mock('./reachability', () => ({ coverServerReachable: () => true }));

import { coverPeekQueued } from './peekQueue';
import { coverEnsureQueued } from './ensureQueue';
import { clearAllDiskSrcCache } from './diskSrcCache';
import { rememberGridDiskSrc } from './diskSrcLookup';
import { albumCoverRef } from './ref';
import { useCoverArt } from './useCoverArt';

const ref = albumCoverRef('pl-1', 'pl-1');
// 200 CSS px at devicePixelRatio 1 resolves to tier 256.
const renderCard = () =>
  renderHook(() => useCoverArt(ref, 200, { surface: 'dense', ensurePriority: 'high' }));

describe('useCoverArt — a smaller tier in memory', () => {
  beforeEach(() => {
    clearAllDiskSrcCache();
    vi.mocked(coverPeekQueued).mockClear();
    vi.mocked(coverEnsureQueued).mockClear();
  });

  it('shows the sidebar thumb first, then loads its own tier', async () => {
    rememberGridDiskSrc(ref, 128, '/cache/pl-1/128.webp');
    const { result } = renderCard();
    expect(result.current.tier).toBe(256);
    expect(decodeURIComponent(result.current.src)).toContain('128.webp');

    await waitFor(() => expect(decodeURIComponent(result.current.src)).toContain('256.webp'));
    expect(coverPeekQueued).toHaveBeenCalledWith(result.current.storageKey, ref, 256);
    expect(coverEnsureQueued).toHaveBeenCalledWith(
      result.current.storageKey, ref, 256, 'high', undefined,
    );
  });

  it('does no work when its own tier is already in memory', async () => {
    rememberGridDiskSrc(ref, 256, '/cache/pl-1/256.webp');
    const { result } = renderCard();
    expect(decodeURIComponent(result.current.src)).toContain('256.webp');
    await Promise.resolve();
    expect(coverPeekQueued).not.toHaveBeenCalled();
    expect(coverEnsureQueued).not.toHaveBeenCalled();
  });
});
