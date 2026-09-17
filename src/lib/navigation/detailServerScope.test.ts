import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@/store/authStore';
import {
  appendServerQuery,
  buildAlbumDetailPath,
  buildArtistDetailPath,
  buildComposerDetailPath,
  buildPlaylistDetailPath,
  readDetailServerId,
} from '@/lib/navigation/detailServerScope';
import { serverIndexKeyFromUrl } from '@/lib/server/serverIndexKey';

describe('detailServerScope', () => {
  beforeEach(() => {
    useAuthStore.setState({
      activeServerId: 'srv-active',
      servers: [
        { id: 'srv-active', name: 'Active', url: 'https://active.test', username: 'u', password: 'p' },
        { id: 'srv-a', name: 'A', url: 'https://a.test', username: 'u', password: 'p' },
        { id: 'srv-b', name: 'B', url: 'https://b.test', username: 'u', password: 'p' },
      ],
    });
  });

  it('readDetailServerId prefers valid ?server= over fallback', () => {
    const params = new URLSearchParams('server=srv-b&lossless=1');
    expect(readDetailServerId(params, 'srv-active')).toBe('srv-b');
  });

  it('readDetailServerId fails closed when an explicit server param is unknown', () => {
    const params = new URLSearchParams('server=missing');
    expect(readDetailServerId(params, 'srv-active')).toBeNull();
  });

  it('resolves route and fallback index keys to profile ids', () => {
    const indexKey = serverIndexKeyFromUrl('https://b.test');
    expect(readDetailServerId(new URLSearchParams(`server=${indexKey}`), 'srv-a')).toBe('srv-b');
    expect(readDetailServerId(new URLSearchParams(), indexKey)).toBe('srv-b');
  });

  it('buildArtistDetailPath preserves search and replaces duplicate server params', () => {
    expect(buildArtistDetailPath('art-1', {
      serverId: 'srv-b',
      search: '?lossless=1&server=old&tab=albums&server=older',
    })).toBe('/artist/art-1?lossless=1&server=srv-b&tab=albums');
  });

  it('buildAlbumDetailPath preserves search and owning server', () => {
    expect(buildAlbumDetailPath('album-1', {
      serverId: 'srv-b',
      search: 'lossless=1',
    })).toBe('/album/album-1?lossless=1&server=srv-b');
  });

  it('buildComposerDetailPath preserves the concrete owner', () => {
    expect(buildComposerDetailPath('composer-1', {
      serverId: 'srv-b',
      search: 'tab=works',
    })).toBe('/composer/composer-1?tab=works&server=srv-b');
  });

  it('buildPlaylistDetailPath preserves search and owning server', () => {
    expect(buildPlaylistDetailPath('playlist-1', {
      serverId: 'srv-b',
      search: 'view=compact&server=old',
    })).toBe('/playlists/playlist-1?view=compact&server=srv-b');
  });

  it('buildArtistDetailPath preserves an existing server when no owner is supplied', () => {
    expect(buildArtistDetailPath('art-1', { search: 'server=srv-a&lossless=1' }))
      .toBe('/artist/art-1?server=srv-a&lossless=1');
  });

  it('appendServerQuery merges with existing query parts', () => {
    expect(appendServerQuery('lossless=1', 'srv-a')).toBe('lossless=1&server=srv-a');
    expect(appendServerQuery(undefined, 'srv-a')).toBe('server=srv-a');
    expect(appendServerQuery('server=old&lossless=1&server=older', 'srv-a'))
      .toBe('server=srv-a&lossless=1');
  });
});
