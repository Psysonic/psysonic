import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  _resetServerCoverCacheForTest,
  normalizeServerCoverUrl,
  resolveCoverForDiscord,
} from './discord';
import { commands } from '@/generated/bindings';
import { getAlbumInfo2 } from '@/lib/api/subsonicAlbumInfo';

vi.mock('@/generated/bindings', () => ({
  commands: {
    resolveAppleCover: vi.fn(),
    resolveLastfmCover: vi.fn(),
  },
}));

vi.mock('@/lib/api/subsonicAlbumInfo', () => ({
  getAlbumInfo2: vi.fn(),
}));

const APPLE_OK = { status: 'ok' as const, data: 'https://apple.example/x.jpg' };
const APPLE_ERR = { status: 'error' as const, error: 'boom' };
const LASTFM_URL = 'https://lastfm.example/y.jpg';

describe('resolveCoverForDiscord', () => {
  beforeEach(() => {
    _resetServerCoverCacheForTest();
    vi.mocked(getAlbumInfo2).mockReset();
    vi.mocked(commands.resolveAppleCover).mockReset();
    vi.mocked(commands.resolveLastfmCover).mockReset();
  });

  it('server miss → apple hit wins (order respected)', async () => {
    vi.mocked(getAlbumInfo2).mockResolvedValue(null as never); // no image → server miss
    vi.mocked(commands.resolveAppleCover).mockResolvedValue(APPLE_OK as never);
    const url = await resolveCoverForDiscord(
      [
        { source: 'server', enabled: true },
        { source: 'apple', enabled: true },
        { source: 'lastfm', enabled: true },
      ],
      { albumId: 'a1', artist: 'X', album: 'Y', title: 'Z', shareBase: null },
    );
    expect(url).toBe('https://apple.example/x.jpg');
    expect(getAlbumInfo2).toHaveBeenCalledWith('a1');
    expect(commands.resolveAppleCover).toHaveBeenCalledWith('X', 'Y', 'Z');
    expect(commands.resolveLastfmCover).not.toHaveBeenCalled();
  });

  it('skips a disabled source and still resolves the enabled one', async () => {
    vi.mocked(commands.resolveLastfmCover).mockResolvedValue(LASTFM_URL);
    const url = await resolveCoverForDiscord(
      [
        { source: 'server', enabled: false },
        { source: 'apple', enabled: false },
        { source: 'lastfm', enabled: true },
      ],
      { artist: 'A', album: 'B', shareBase: null },
    );
    expect(url).toBe(LASTFM_URL);
    expect(getAlbumInfo2).not.toHaveBeenCalled();
    expect(commands.resolveAppleCover).not.toHaveBeenCalled();
  });

  it('no enabled source → null', async () => {
    const url = await resolveCoverForDiscord(
      [
        { source: 'server', enabled: false },
        { source: 'apple', enabled: false },
        { source: 'lastfm', enabled: false },
      ],
      { artist: 'A', album: 'B', shareBase: null },
    );
    expect(url).toBeNull();
  });

  it('rejects a Last.fm placeholder URL and returns null when nothing else resolves', async () => {
    vi.mocked(getAlbumInfo2).mockResolvedValue(null as never);
    vi.mocked(commands.resolveLastfmCover).mockResolvedValue(
      'https://lastfm.example/2a96cbd8b46e442fc41c2b86b821562f.png',
    );
    const url = await resolveCoverForDiscord(
      [
        { source: 'server', enabled: true },
        { source: 'lastfm', enabled: true },
      ],
      { albumId: 'a1', artist: 'A', album: 'B', shareBase: null },
    );
    expect(url).toBeNull();
  });

  it('an apple error result is treated as a miss and walks on', async () => {
    vi.mocked(getAlbumInfo2).mockResolvedValue(null as never);
    vi.mocked(commands.resolveAppleCover).mockResolvedValue(APPLE_ERR as never);
    vi.mocked(commands.resolveLastfmCover).mockResolvedValue(LASTFM_URL);
    const url = await resolveCoverForDiscord(
      [
        { source: 'server', enabled: true },
        { source: 'apple', enabled: true },
        { source: 'lastfm', enabled: true },
      ],
      { albumId: 'a1', artist: 'A', album: 'B', title: 'C', shareBase: null },
    );
    expect(url).toBe(LASTFM_URL);
  });

  it('sanitizes a non-https URL to null (never returns it)', async () => {
    vi.mocked(getAlbumInfo2).mockResolvedValue(null as never);
    vi.mocked(commands.resolveLastfmCover).mockResolvedValue('http://lastfm.example/y.jpg');
    const url = await resolveCoverForDiscord(
      [
        { source: 'server', enabled: false },
        { source: 'apple', enabled: false },
        { source: 'lastfm', enabled: true },
      ],
      { artist: 'A', album: 'B', shareBase: null },
    );
    expect(url).toBeNull();
  });

  it('keeps external Last.fm HTTPS URLs intact without rewriting to shareBase', async () => {
    vi.mocked(getAlbumInfo2).mockResolvedValue({
      largeImageUrl: 'https://lastfm.freetls.fastly.net/i/u/300x300/abc.png',
    } as never);
    const url = await resolveCoverForDiscord(
      [{ source: 'server', enabled: true }],
      { albumId: 'a1', shareBase: 'https://music.example.com' },
    );
    expect(url).toBe('https://lastfm.freetls.fastly.net/i/u/300x300/abc.png');
  });

  it('upgrades external HTTP CDN URLs to HTTPS', async () => {
    vi.mocked(getAlbumInfo2).mockResolvedValue({
      largeImageUrl: 'http://lastfm.freetls.fastly.net/i/u/300x300/abc.png',
    } as never);
    const url = await resolveCoverForDiscord(
      [{ source: 'server', enabled: true }],
      { albumId: 'a1', shareBase: 'https://music.example.com' },
    );
    expect(url).toBe('https://lastfm.freetls.fastly.net/i/u/300x300/abc.png');
  });

  it('rewrites server /share/img/ URLs to public shareBase', async () => {
    vi.mocked(getAlbumInfo2).mockResolvedValue({
      largeImageUrl: 'http://192.168.1.50:4533/share/img/token-123?size=600',
    } as never);
    const url = await resolveCoverForDiscord(
      [{ source: 'server', enabled: true }],
      { albumId: 'a1', shareBase: 'https://music.example.com' },
    );
    expect(url).toBe('https://music.example.com/share/img/token-123?size=600');
  });

  it('resolves relative /share/img/ paths against shareBase with path prefix', async () => {
    vi.mocked(getAlbumInfo2).mockResolvedValue({
      largeImageUrl: '/share/img/token-456?size=300',
    } as never);
    const url = await resolveCoverForDiscord(
      [{ source: 'server', enabled: true }],
      { albumId: 'a1', shareBase: 'https://music.example.com/nav' },
    );
    expect(url).toBe('https://music.example.com/nav/share/img/token-456?size=300');
  });

  it('negative cache expires after 30 seconds while hit cache lasts 1 hour', async () => {
    vi.useFakeTimers();
    try {
      // First call fails (negative cache)
      vi.mocked(getAlbumInfo2).mockResolvedValueOnce(null as never);
      await resolveCoverForDiscord(
        [{ source: 'server', enabled: true }],
        { albumId: 'a1', shareBase: null },
      );
      expect(getAlbumInfo2).toHaveBeenCalledTimes(1);

      // Immediate second call should hit the negative cache
      await resolveCoverForDiscord(
        [{ source: 'server', enabled: true }],
        { albumId: 'a1', shareBase: null },
      );
      expect(getAlbumInfo2).toHaveBeenCalledTimes(1);

      // Advance 31 seconds -> negative cache should expire
      vi.advanceTimersByTime(31 * 1000);
      vi.mocked(getAlbumInfo2).mockResolvedValueOnce({
        largeImageUrl: 'https://lastfm.example/cover.jpg',
      } as never);
      const url = await resolveCoverForDiscord(
        [{ source: 'server', enabled: true }],
        { albumId: 'a1', shareBase: null },
      );
      expect(url).toBe('https://lastfm.example/cover.jpg');
      expect(getAlbumInfo2).toHaveBeenCalledTimes(2);

      // Advance 30 minutes -> positive cache (1h TTL) should still be valid
      vi.advanceTimersByTime(30 * 60 * 1000);
      const cachedUrl = await resolveCoverForDiscord(
        [{ source: 'server', enabled: true }],
        { albumId: 'a1', shareBase: null },
      );
      expect(cachedUrl).toBe('https://lastfm.example/cover.jpg');
      expect(getAlbumInfo2).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('normalizeServerCoverUrl', () => {
  it('does not touch external HTTPS URLs', () => {
    expect(
      normalizeServerCoverUrl(
        'https://lastfm.freetls.fastly.net/i/u/300x300/xyz.jpg',
        'https://music.example.com',
      ),
    ).toBe('https://lastfm.freetls.fastly.net/i/u/300x300/xyz.jpg');
  });

  it('upgrades external HTTP URLs to HTTPS', () => {
    expect(
      normalizeServerCoverUrl(
        'http://lastfm.freetls.fastly.net/i/u/300x300/xyz.jpg',
        'https://music.example.com',
      ),
    ).toBe('https://lastfm.freetls.fastly.net/i/u/300x300/xyz.jpg');
  });

  it('does not upgrade local/LAN HTTP URLs', () => {
    expect(
      normalizeServerCoverUrl(
        'http://192.168.1.10:8080/image.jpg',
        'https://music.example.com',
      ),
    ).toBe('http://192.168.1.10:8080/image.jpg');
  });

  it('rewrites server artwork to public shareBase and preserves prefix', () => {
    expect(
      normalizeServerCoverUrl(
        'http://192.168.1.10:4533/share/img/tok?size=500',
        'https://sub.example.com/prefix',
      ),
    ).toBe('https://sub.example.com/prefix/share/img/tok?size=500');
  });

  it('rewrites server artwork to public shareBase for home-network hostnames matching serverAddresses', () => {
    expect(
      normalizeServerCoverUrl(
        'http://my-nas.fritz.box:4533/share/img/tok?size=500',
        'https://sub.example.com/prefix',
        ['http://my-nas.fritz.box:4533'],
      ),
    ).toBe('https://sub.example.com/prefix/share/img/tok?size=500');
  });

  it('rewrites server artwork to public shareBase for Tailscale addresses matching serverAddresses', () => {
    expect(
      normalizeServerCoverUrl(
        'http://100.64.1.2:4533/share/img/tok?size=500',
        'https://sub.example.com/prefix',
        ['http://100.64.1.2:4533'],
      ),
    ).toBe('https://sub.example.com/prefix/share/img/tok?size=500');
  });

  it('does not rewrite third-party URLs that happen to have /share/img/ in path', () => {
    expect(
      normalizeServerCoverUrl(
        'https://external-cdn.example.com/share/img/abc.jpg',
        'https://sub.example.com/prefix',
        ['http://my-nas.fritz.box:4533'],
      ),
    ).toBe('https://external-cdn.example.com/share/img/abc.jpg');
  });

  it('handles protocol-relative URLs', () => {
    expect(
      normalizeServerCoverUrl(
        '//cdn.example.com/art.jpg',
        'https://sub.example.com/prefix',
      ),
    ).toBe('https://cdn.example.com/art.jpg');
  });

  it('resolves relative paths with shareBase prefix', () => {
    expect(
      normalizeServerCoverUrl('/share/img/tok?size=500', 'https://sub.example.com/prefix'),
    ).toBe('https://sub.example.com/prefix/share/img/tok?size=500');
  });

  it('returns raw when shareBase is null for relative paths', () => {
    expect(normalizeServerCoverUrl('/share/img/tok', null)).toBe('/share/img/tok');
  });
});
