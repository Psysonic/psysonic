import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { albumCoverRef } from './ref';
import { coverStorageKeyFromRef } from './storageKeys';

vi.mock('./diskSrcCache', () => ({
  rememberDiskSrc: vi.fn(() => 'asset://cover.webp'),
  getDiskSrc: vi.fn(() => ''),
  splitPathVersion: (fsPath: string) => {
    const sep = fsPath.lastIndexOf('|');
    if (sep < 0 || !/^\d+$/.test(fsPath.slice(sep + 1))) {
      return { path: fsPath, version: '' };
    }
    return { path: fsPath.slice(0, sep), version: fsPath.slice(sep + 1) };
  },
}));

vi.mock('./diskHandoff', () => ({
  hasCoverDiskReadyListeners: vi.fn(() => true),
  notifyCoverDiskReady: vi.fn(),
}));

import { getDiskSrc, rememberDiskSrc } from './diskSrcCache';
import { notifyCoverDiskReady } from './diskHandoff';
import {
  getDiskSrcForGrid,
  gridDiskSrcLookupOrder,
  hasDiskSrcForTier,
  rememberDiskSrcLadder,
  rememberGridDiskSrc,
} from './diskSrcLookup';

describe('gridDiskSrcLookupOrder', () => {
  it('prefers 800 right after 512 when 512 is wanted', () => {
    expect(gridDiskSrcLookupOrder(512)).toEqual([512, 800, 256, 128]);
  });

  it('prefers 800 for 256 display tier', () => {
    expect(gridDiskSrcLookupOrder(256)[1]).toBe(800);
  });
});

describe('rememberGridDiskSrc', () => {
  beforeEach(() => {
    vi.mocked(rememberDiskSrc).mockClear();
    vi.mocked(notifyCoverDiskReady).mockClear();
    vi.mocked(rememberDiskSrc).mockReturnValue('asset://x');
  });

  it('seeds 512 and 800 keys from one on-disk path (800.webp fallback)', () => {
    const ref = albumCoverRef('al-1', 'al-1');
    const hit = rememberGridDiskSrc(ref, 512, '/data/800.webp');
    expect(hit).toBe(true);
    expect(vi.mocked(rememberDiskSrc).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(vi.mocked(notifyCoverDiskReady)).toHaveBeenCalledTimes(1);
  });
});

describe('rememberDiskSrcLadder', () => {
  beforeEach(() => {
    vi.mocked(rememberDiskSrc).mockClear();
    vi.mocked(rememberDiskSrc).mockReturnValue('asset://x');
  });

  it('seeds 128 when only 800.webp path arrives', () => {
    const hit = rememberDiskSrcLadder('srv', { cacheKind: 'album', cacheEntityId: 'al-1' }, 128, '/data/800.webp');
    expect(hit).toBe(true);
    const keys = vi.mocked(rememberDiskSrc).mock.calls.map(c => c[0]);
    expect(keys).toContain('srv:cover:album:al-1:128');
    expect(keys).toContain('srv:cover:album:al-1:800');
  });

  it('seeds the versioned URL from the `path|version` wire format', () => {
    const hit = rememberDiskSrcLadder(
      'srv',
      { cacheKind: 'album', cacheEntityId: 'al-1' },
      128,
      '/data/800.webp|1787826019',
    );
    expect(hit).toBe(true);
    const calls = vi.mocked(rememberDiskSrc).mock.calls;
    expect(calls.some(([k, v]) => k === 'srv:cover:album:al-1:128' && v === '/data/800.webp|1787826019')).toBe(true);
  });

  it('applies full-res seed guards to versioned paths too', () => {
    const ref = albumCoverRef('al-1', 'al-1');
    rememberGridDiskSrc(ref, 2000, '/data/512.webp|1787826019');
    const keys = vi.mocked(rememberDiskSrc).mock.calls.map(c => c[0]);
    expect(keys.some(k => k.endsWith(':2000'))).toBe(false);
    expect(keys.some(k => k.endsWith(':512'))).toBe(true);
  });
});

describe('full-res (2000) seed guard', () => {
  beforeEach(() => {
    vi.mocked(rememberDiskSrc).mockClear();
    vi.mocked(rememberDiskSrc).mockReturnValue('asset://x');
  });

  it('never seeds the 2000 key from a smaller tier file', () => {
    const ref = albumCoverRef('al-1', 'al-1');
    rememberGridDiskSrc(ref, 2000, '/data/512.webp');
    const keys = vi.mocked(rememberDiskSrc).mock.calls.map(c => c[0]);
    expect(keys.some(k => k.endsWith(':2000'))).toBe(false);
    // Smaller display keys are still seeded.
    expect(keys.some(k => k.endsWith(':512'))).toBe(true);
  });

  it('seeds the 2000 key from a real 2000 file', () => {
    const ref = albumCoverRef('al-1', 'al-1');
    rememberGridDiskSrc(ref, 2000, '/data/2000.webp');
    const keys = vi.mocked(rememberDiskSrc).mock.calls.map(c => c[0]);
    expect(keys.some(k => k.endsWith(':2000'))).toBe(true);
  });

  it('never seeds display keys from a full-res (2000) file', () => {
    const ref = albumCoverRef('al-1', 'al-1');
    rememberGridDiskSrc(ref, 2000, '/data/2000.webp');
    const keys = vi.mocked(rememberDiskSrc).mock.calls.map(c => c[0]);
    // Only the 2000 key may be seeded from a 2000.webp file. A tier-2000 file
    // can be the Navidrome vinyl placeholder written by the lightbox's full-res
    // path for a coverless album; seeding :800 with it is exactly the
    // single-frame hero flash (vinyl shows for one frame, then the re-ensure
    // peek reseeds :800 with real art).
    expect(keys).toEqual(['_:cover:album:al-1:2000']);
  });

  it('seeds display keys from an 800 file as before', () => {
    const ref = albumCoverRef('al-1', 'al-1');
    rememberGridDiskSrc(ref, 800, '/data/800.webp');
    const keys = vi.mocked(rememberDiskSrc).mock.calls.map(c => c[0]);
    expect(keys.some(k => k.endsWith(':800'))).toBe(true);
    expect(keys.some(k => k.endsWith(':512'))).toBe(true);
    expect(keys.some(k => k.endsWith(':256'))).toBe(true);
    expect(keys.some(k => k.endsWith(':128'))).toBe(true);
  });
});

describe('a small thumb never stands in for a larger cell', () => {
  const store = new Map<string, string>();
  const ref = albumCoverRef('pl-1', 'pl-1');
  const tiersInStore = () => [...store.keys()].map(k => k.split(':').pop());

  beforeEach(() => {
    store.clear();
    vi.mocked(rememberDiskSrc).mockImplementation((key: string, path: string) => {
      store.set(key, path);
      return path;
    });
    vi.mocked(getDiskSrc).mockImplementation((key: string) => store.get(key) ?? '');
  });

  afterEach(() => {
    vi.mocked(rememberDiskSrc).mockImplementation(() => 'asset://cover.webp');
    vi.mocked(getDiskSrc).mockImplementation(() => '');
  });

  it('keeps a 128 file out of the larger keys a grid cell reads', () => {
    // The 20px sidebar thumb peeks 128.webp; a 256 card reads `:800` second.
    rememberGridDiskSrc(ref, 128, '/cache/pl-1/128.webp');
    expect(tiersInStore()).toEqual(['128']);
  });

  it('shows the smaller file only as a stand-in until the wanted tier is loaded', () => {
    rememberGridDiskSrc(ref, 128, '/cache/pl-1/128.webp');
    expect(getDiskSrcForGrid(ref, 256)).toBe('/cache/pl-1/128.webp');
    expect(hasDiskSrcForTier(ref, 256)).toBe(false);
    expect(hasDiskSrcForTier(ref, 128)).toBe(true);
  });

  it('counts a larger file as loaded for every smaller cell', () => {
    rememberGridDiskSrc(ref, 256, '/cache/pl-1/800.webp');
    expect(hasDiskSrcForTier(ref, 128)).toBe(true);
    expect(hasDiskSrcForTier(ref, 256)).toBe(true);
    expect(hasDiskSrcForTier(ref, 512)).toBe(true);
  });

  it('applies the rule to versioned paths and tier-ready events', () => {
    rememberDiskSrcLadder('_', { cacheKind: 'album', cacheEntityId: 'pl-1' }, 128, '/cache/pl-1/128.webp|1787826019');
    expect(tiersInStore()).toEqual(['128']);
    expect(hasDiskSrcForTier(ref, 256)).toBe(false);
  });

  it('loads again when eviction leaves only a larger key the lookup never reads', () => {
    // A 512 card keeps `:512` recent; the LRU dropped the 128 cell's `:128` and `:800`.
    store.set(coverStorageKeyFromRef(ref, 512), '/cache/pl-1/512.webp');
    expect(getDiskSrcForGrid(ref, 128)).toBe('');
    expect(hasDiskSrcForTier(ref, 128)).toBe(false);
  });

  it('reports done only when the lookup shows a file of at least the wanted tier', () => {
    const displayTiers = [64, 128, 256, 512, 800] as const;
    let done = 0;
    for (const want of displayTiers) {
      for (const held of displayTiers) {
        store.clear();
        store.set(coverStorageKeyFromRef(ref, held), `/cache/pl-1/${held}.webp`);
        if (!hasDiskSrcForTier(ref, want)) continue;
        done += 1;
        const shown = getDiskSrcForGrid(ref, want);
        expect(shown, `want ${want}, held ${held}`).not.toBe('');
        expect(Number(/(\d+)\.webp$/.exec(shown)?.[1])).toBeGreaterThanOrEqual(want);
      }
    }
    expect(done).toBeGreaterThan(0);
  });

  // Making hero/fullscreen load their 2000 tier here would add full-res
  // downloads on every visit; that stays outside this fix.
  it('lets full-res surfaces settle for a display tier as before', () => {
    expect(hasDiskSrcForTier(ref, 2000)).toBe(false);
    rememberGridDiskSrc(ref, 800, '/cache/pl-1/800.webp');
    expect(hasDiskSrcForTier(ref, 2000)).toBe(true);
  });
});
