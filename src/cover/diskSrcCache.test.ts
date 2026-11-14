import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(() => true),
  convertFileSrc: vi.fn(),
}));

import { convertFileSrc } from '@tauri-apps/api/core';
import {
  clearAllDiskSrcCache,
  coverDiskUrl,
  forgetDiskSrcForServer,
  forgetDiskSrcPrefix,
  getDiskSrc,
  refreshDiskSrcVersions,
  rememberDiskSrc,
  subscribeDiskSrcCache,
} from './diskSrcCache';

describe('coverDiskUrl', () => {
  beforeEach(() => {
    vi.mocked(convertFileSrc).mockReset();
  });

  it('rejects raw Windows path when convertFileSrc returns passthrough', () => {
    const fsPath =
      'C:\\Users\\me\\AppData\\Roaming\\dev.psysonic.player\\cover-cache\\srv\\al-1\\128.webp';
    vi.mocked(convertFileSrc).mockReturnValue(fsPath);
    expect(coverDiskUrl(fsPath)).toBe('');
  });

  it('accepts asset.localhost URLs from convertFileSrc', () => {
    const fsPath = 'C:\\cache\\cover-cache\\srv\\al-1\\128.webp';
    vi.mocked(convertFileSrc).mockReturnValue('https://asset.localhost/C%3A%2Fcache%2F128.webp');
    expect(coverDiskUrl(fsPath)).toBe('https://asset.localhost/C%3A%2Fcache%2F128.webp');
  });

  it('normalizes Windows backslashes before convertFileSrc', () => {
    const fsPath = 'C:\\Users\\me\\cover-cache\\al-1\\128.webp';
    vi.mocked(convertFileSrc).mockImplementation((p: string) =>
      `https://asset.localhost/${encodeURIComponent(p)}`,
    );
    const url = coverDiskUrl(fsPath);
    expect(convertFileSrc).toHaveBeenCalledWith('C:/Users/me/cover-cache/al-1/128.webp');
    expect(url).toContain('asset.localhost');
  });

  it('accepts asset: protocol URLs from convertFileSrc', () => {
    const fsPath = '/home/u/.local/share/dev.psysonic.player/cover-cache/srv/al-1/128.webp';
    vi.mocked(convertFileSrc).mockReturnValue('asset://localhost/home/u/.../128.webp');
    expect(coverDiskUrl(fsPath)).toBe('asset://localhost/home/u/.../128.webp');
  });

  it('appends the mtime version from `path|version` as a cache-busting query', () => {
    const fsPath = '/cache/srv/al-1/128.webp|1787826019';
    vi.mocked(convertFileSrc).mockImplementation(
      (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
    );
    const url = coverDiskUrl(fsPath);
    expect(convertFileSrc).toHaveBeenCalledWith('/cache/srv/al-1/128.webp');
    expect(url).toBe(
      `asset://localhost/${encodeURIComponent('/cache/srv/al-1/128.webp')}?v=1787826019`,
    );
  });

  it('ignores a non-numeric pipe suffix (treats the whole string as a path)', () => {
    const fsPath = '/cache/srv/al-1/128.webp|notaversion';
    vi.mocked(convertFileSrc).mockImplementation(
      (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
    );
    const url = coverDiskUrl(fsPath);
    expect(convertFileSrc).toHaveBeenCalledWith(fsPath);
    expect(url).not.toContain('?v=');
  });

  it('produces a different URL when the version changes (in-place overwrite)', () => {
    vi.mocked(convertFileSrc).mockImplementation(
      (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
    );
    const old = coverDiskUrl('/cache/srv/al-1/800.webp|1000');
    const fresh = coverDiskUrl('/cache/srv/al-1/800.webp|2000');
    expect(old).not.toBe(fresh);
    expect(fresh.endsWith('?v=2000')).toBe(true);
  });
});

describe('rememberDiskSrc', () => {
  beforeEach(() => {
    vi.mocked(convertFileSrc).mockReset();
    clearAllDiskSrcCache();
  });

  it('does not cache when coverDiskUrl rejects the path', () => {
    const fsPath = 'C:\\bad\\128.webp';
    vi.mocked(convertFileSrc).mockReturnValue(fsPath);
    expect(rememberDiskSrc('srv:cover:al-1:128', fsPath)).toBe('');
    expect(getDiskSrc('srv:cover:al-1:128')).toBe('');
  });
});

describe('refreshDiskSrcVersions (short-edge refit rewrote tiers in place)', () => {
  const url = (p: string, v: number) => `asset://localhost/${encodeURIComponent(p)}?v=${v}`;
  let generations = 0;
  let unsubscribe = () => {};

  beforeEach(() => {
    vi.mocked(convertFileSrc).mockImplementation((p: string) =>
      `asset://localhost/${encodeURIComponent(p)}`,
    );
    clearAllDiskSrcCache();
    unsubscribe();
    generations = 0;
    unsubscribe = subscribeDiskSrcCache(() => {
      generations += 1;
    });
  });

  it('moves every key cached for a rewritten file to its new version', () => {
    rememberDiskSrc('srv:cover:album:pl-1:128', '/disk/pl-1/128.webp|100');
    rememberDiskSrc('srv:cover:album:pl-1:64', '/disk/pl-1/128.webp|100');
    rememberDiskSrc('srv:cover:album:pl-1:800', '/disk/pl-1/800.webp|100');
    generations = 0;

    refreshDiskSrcVersions(['/disk/pl-1/128.webp|200', '/disk/pl-2/128.webp|200']);

    expect(getDiskSrc('srv:cover:album:pl-1:128')).toBe(url('/disk/pl-1/128.webp', 200));
    expect(getDiskSrc('srv:cover:album:pl-1:64')).toBe(url('/disk/pl-1/128.webp', 200));
    // Untouched file keeps its URL; nothing is dropped or added.
    expect(getDiskSrc('srv:cover:album:pl-1:800')).toBe(url('/disk/pl-1/800.webp', 100));
    expect(getDiskSrc('srv:cover:album:pl-2:128')).toBe('');
    expect(generations).toBe(1);
  });

  it('does not wake subscribers when no cached entry matches', () => {
    rememberDiskSrc('srv:cover:album:pl-1:800', '/disk/pl-1/800.webp|100');
    generations = 0;
    refreshDiskSrcVersions(['/disk/pl-9/128.webp|200']);
    expect(generations).toBe(0);
  });

  it('keeps the rewritten version when a peek read before the rewrite answers late', () => {
    rememberDiskSrc('srv:cover:album:pl-1:128', '/disk/pl-1/128.webp|100');
    refreshDiskSrcVersions(['/disk/pl-1/128.webp|200']);

    expect(rememberDiskSrc('srv:cover:album:pl-1:128', '/disk/pl-1/128.webp|100')).toBe(
      url('/disk/pl-1/128.webp', 200),
    );
    expect(getDiskSrc('srv:cover:album:pl-1:128')).toBe(url('/disk/pl-1/128.webp', 200));
    // A newer version still replaces it.
    rememberDiskSrc('srv:cover:album:pl-1:128', '/disk/pl-1/128.webp|300');
    expect(getDiskSrc('srv:cover:album:pl-1:128')).toBe(url('/disk/pl-1/128.webp', 300));
  });
});

const serverScopeA = {
  kind: 'server' as const,
  serverId: 'profile-a',
  url: 'http://srv-a',
  username: 'u',
  password: 'p',
};

describe('forgetDiskSrcForServer', () => {
  beforeEach(() => {
    vi.mocked(convertFileSrc).mockImplementation((p: string) =>
      `asset://localhost/${encodeURIComponent(p)}`,
    );
    clearAllDiskSrcCache();
  });

  it('drops every cached entry under the given server index key', () => {
    rememberDiskSrc('srv-a:cover:album:al-1:128', '/disk/a/al-1/128.webp');
    rememberDiskSrc('srv-a:cover:album:al-1:512', '/disk/a/al-1/512.webp');
    rememberDiskSrc('srv-a:cover:album:al-2:128', '/disk/a/al-2/128.webp');
    rememberDiskSrc('srv-b:cover:album:al-1:128', '/disk/b/al-1/128.webp');

    forgetDiskSrcForServer('srv-a');

    expect(getDiskSrc('srv-a:cover:album:al-1:128')).toBe('');
    expect(getDiskSrc('srv-a:cover:album:al-1:512')).toBe('');
    expect(getDiskSrc('srv-a:cover:album:al-2:128')).toBe('');
    // Other servers untouched — this is the URL-change remigration path,
    // not a global purge.
    expect(getDiskSrc('srv-b:cover:album:al-1:128')).not.toBe('');
  });

  it('is a no-op on an empty key (defensive)', () => {
    rememberDiskSrc('srv-a:cover:album:al-1:128', '/disk/a/al-1/128.webp');
    forgetDiskSrcForServer('');
    expect(getDiskSrc('srv-a:cover:album:al-1:128')).not.toBe('');
  });

  it('is a no-op when nothing matches the prefix', () => {
    rememberDiskSrc('srv-a:cover:album:al-1:128', '/disk/a/al-1/128.webp');
    forgetDiskSrcForServer('srv-missing');
    expect(getDiskSrc('srv-a:cover:album:al-1:128')).not.toBe('');
  });
});

describe('forgetDiskSrcPrefix (regression — must not be confused with forgetDiskSrcForServer)', () => {
  beforeEach(() => {
    vi.mocked(convertFileSrc).mockImplementation((p: string) =>
      `asset://localhost/${encodeURIComponent(p)}`,
    );
    clearAllDiskSrcCache();
  });

  it('only clears the (server, cache entity) tuple', () => {
    rememberDiskSrc('srv-a:cover:album:al-1:128', '/disk/a/al-1/128.webp');
    rememberDiskSrc('srv-a:cover:album:al-2:128', '/disk/a/al-2/128.webp');
    forgetDiskSrcPrefix({
      serverScope: serverScopeA,
      cacheKind: 'album',
      cacheEntityId: 'al-1',
    });
    expect(getDiskSrc('srv-a:cover:album:al-1:128')).toBe('');
    expect(getDiskSrc('srv-a:cover:album:al-2:128')).not.toBe('');
  });
});
