import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';

const mocks = vi.hoisted(() => ({
  authState: {
    current: {
      servers: [] as Array<{ id: string; name: string; url: string; username: string; password: string }>,
      isLoggedIn: true,
      activeServerId: 'active',
      setActiveServer: vi.fn(),
    },
  },
  enqueue: vi.fn(),
  getAlbum: vi.fn(),
  resolveAlbum: vi.fn(),
  getArtist: vi.fn(),
  resolveArtist: vi.fn(),
  resolvePlaylist: vi.fn(),
  getSongForServer: vi.fn(),
  orbitBulkGuard: vi.fn(),
  showToast: vi.fn(),
  songToTrack: vi.fn(),
  normalizeNavidromeExternalId: vi.fn((_serverId: string, id: string) => id),
}));

vi.mock('@/lib/api/subsonicLibrary', () => ({
  getAlbum: mocks.getAlbum,
  getSongForServer: mocks.getSongForServer,
}));

vi.mock('@/lib/api/subsonicArtists', () => ({
  getArtist: mocks.getArtist,
}));

vi.mock('@/store/mediaResolver', () => ({
  resolveAlbum: mocks.resolveAlbum,
  resolveArtist: mocks.resolveArtist,
  resolvePlaylist: mocks.resolvePlaylist,
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: {
    getState: () => mocks.authState.current,
  },
}));

vi.mock('@/features/playback/store/playerStore', () => ({
  usePlayerStore: {
    getState: () => ({ enqueue: mocks.enqueue }),
  },
}));

vi.mock('@/lib/media/songToTrack', () => ({
  songToTrack: mocks.songToTrack,
}));

vi.mock('@/features/orbit', () => ({
  orbitBulkGuard: mocks.orbitBulkGuard,
}));

vi.mock('@/lib/dom/toast', () => ({
  showToast: mocks.showToast,
}));

vi.mock('@/lib/server/navidromeCanonicalExternalId', () => ({
  normalizeNavidromeExternalId: mocks.normalizeNavidromeExternalId,
}));

import {
  activateShareSearchServer,
  enqueueShareSearchPayload,
  resolveShareSearchAlbum,
  resolveShareSearchArtist,
  resolveShareSearchPayload,
  resolveShareSearchPlaylist,
} from '@/features/share/enqueueShareSearchPayload';

const sharedServer = {
  id: 'shared',
  name: 'Shared',
  url: 'https://shared.example.com',
  username: 'shared-user',
  password: 'shared-pass',
};

const activeServer = {
  id: 'active',
  name: 'Active',
  url: 'https://active.example.com',
  username: 'active-user',
  password: 'active-pass',
};

const sharedSong = {
  id: 'song-1',
  title: 'Shared Song',
  artist: 'Shared Artist',
  album: 'Shared Album',
  albumId: 'album-1',
  duration: 180,
  minutesAgo: 0,
  playerId: 0,
  playerName: '',
};

describe('share search payload resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authState.current = {
      servers: [activeServer, sharedServer],
      isLoggedIn: true,
      activeServerId: 'active',
      setActiveServer: vi.fn(),
    };
    mocks.getSongForServer.mockResolvedValue({ ...sharedSong, serverId: 'shared' });
    mocks.resolveAlbum.mockResolvedValue({
      album: { id: 'album-1', name: 'Shared Album', artist: 'Shared Artist' },
      songs: [],
    });
    mocks.resolveArtist.mockResolvedValue({
      artist: { id: 'artist-1', name: 'Shared Artist' },
      albums: [],
    });
    mocks.resolvePlaylist.mockResolvedValue({
      playlist: {
        id: 'playlist-1',
        name: 'Shared Playlist',
        songCount: 1,
        duration: 180,
        created: '',
        changed: '',
      },
      songs: [],
    });
    mocks.songToTrack.mockImplementation(song => ({
      id: song.id,
      title: song.title,
      serverId: song.serverId,
    }));
    mocks.orbitBulkGuard.mockResolvedValue(true);
    mocks.normalizeNavidromeExternalId.mockImplementation((_serverId: string, id: string) => id);
  });

  it('resolves a shared track preview through its explicit server without switching active server', async () => {
    const result = await resolveShareSearchPayload({
      srv: 'https://shared.example.com',
      k: 'track',
      id: 'song-1',
    });

    expect(result).toEqual({
      type: 'ok',
      songs: [{ ...sharedSong, serverId: 'shared' }],
      total: 1,
      skipped: 0,
    });
    expect(mocks.getSongForServer).toHaveBeenCalledWith('shared', 'song-1');
    expect(mocks.authState.current.setActiveServer).not.toHaveBeenCalled();
  });

  it('resolves album and artist previews without switching active server', async () => {
    const albumResult = await resolveShareSearchAlbum({
      srv: 'https://shared.example.com',
      k: 'album',
      id: 'album-1',
    });
    const artistResult = await resolveShareSearchArtist({
      srv: 'https://shared.example.com',
      k: 'artist',
      id: 'artist-1',
    });

    expect(mocks.resolveAlbum).toHaveBeenCalledWith('shared', 'album-1');
    expect(mocks.resolveArtist).toHaveBeenCalledWith('shared', 'artist-1');
    expect(mocks.getAlbum).not.toHaveBeenCalled();
    expect(mocks.getArtist).not.toHaveBeenCalled();
    expect(mocks.authState.current.setActiveServer).not.toHaveBeenCalled();
    expect(albumResult).toMatchObject({ type: 'ok', album: { serverId: 'shared' } });
    expect(artistResult).toMatchObject({ type: 'ok', artist: { serverId: 'shared' } });
  });

  it('resolves composer previews via artist credentials without switching active server', async () => {
    const result = await resolveShareSearchArtist({
      srv: 'https://shared.example.com',
      k: 'composer',
      id: 'composer-1',
    });

    expect(result.type).toBe('ok');
    expect(mocks.resolveArtist).toHaveBeenCalledWith('shared', 'composer-1');
    expect(mocks.authState.current.setActiveServer).not.toHaveBeenCalled();
  });

  it('resolves playlist previews without switching active server', async () => {
    const result = await resolveShareSearchPlaylist({
      srv: 'https://shared.example.com',
      k: 'playlist',
      id: 'playlist-1',
    });

    expect(mocks.resolvePlaylist).toHaveBeenCalledWith('shared', 'playlist-1');
    expect(result).toMatchObject({
      type: 'ok',
      playlist: { id: 'playlist-1', serverId: 'shared' },
    });
    expect(mocks.authState.current.setActiveServer).not.toHaveBeenCalled();
  });

  it('normalizes durable IDs before resolving every payload kind', async () => {
    mocks.normalizeNavidromeExternalId.mockImplementation((_serverId: string, id: string) => `canonical-${id}`);

    await resolveShareSearchPayload({
      srv: 'https://shared.example.com',
      k: 'queue',
      ids: ['song-1', 'song-2'],
    });
    await resolveShareSearchAlbum({
      srv: 'https://shared.example.com',
      k: 'album',
      id: 'album-1',
    });
    await resolveShareSearchArtist({
      srv: 'https://shared.example.com',
      k: 'composer',
      id: 'composer-1',
    });
    await resolveShareSearchPlaylist({
      srv: 'https://shared.example.com',
      k: 'playlist',
      id: 'playlist-1',
    });

    expect(mocks.getSongForServer).toHaveBeenNthCalledWith(1, 'shared', 'canonical-song-1');
    expect(mocks.getSongForServer).toHaveBeenNthCalledWith(2, 'shared', 'canonical-song-2');
    expect(mocks.resolveAlbum).toHaveBeenCalledWith('shared', 'canonical-album-1');
    expect(mocks.resolveArtist).toHaveBeenCalledWith('shared', 'canonical-composer-1');
    expect(mocks.resolvePlaylist).toHaveBeenCalledWith('shared', 'canonical-playlist-1');
  });

  it('returns not-logged-in without calling the API', async () => {
    mocks.authState.current.isLoggedIn = false;

    const result = await resolveShareSearchPayload({
      srv: 'https://shared.example.com',
      k: 'track',
      id: 'song-1',
    });

    expect(result).toEqual({ type: 'not-logged-in' });
    expect(mocks.getSongForServer).not.toHaveBeenCalled();
  });

  it('activates the share server for confirmed enqueue actions', async () => {
    const t = ((key: string) => key) as TFunction;
    const ok = await enqueueShareSearchPayload({
      srv: 'https://shared.example.com',
      k: 'track',
      id: 'song-1',
    }, t);

    expect(ok).toBe(true);
    expect(mocks.authState.current.setActiveServer).toHaveBeenCalledWith('shared');
    expect(mocks.getSongForServer).toHaveBeenCalledWith('shared', 'song-1');
    expect(mocks.songToTrack.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ serverId: 'shared' }));
    expect(mocks.enqueue).toHaveBeenCalledWith([
      { id: 'song-1', title: 'Shared Song', serverId: 'shared' },
    ], true);
  });

  it('aborts enqueue when orbitBulkGuard rejects the bulk add', async () => {
    mocks.orbitBulkGuard.mockResolvedValue(false);
    const t = ((key: string) => key) as TFunction;

    const ok = await enqueueShareSearchPayload({
      srv: 'https://shared.example.com',
      k: 'track',
      id: 'song-1',
    }, t);

    expect(ok).toBe(false);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.authState.current.setActiveServer).not.toHaveBeenCalled();
  });

  it('reports partial queue enqueue with a partial toast', async () => {
    mocks.getSongForServer.mockImplementation((_serverId: string, id: string) =>
      id === 'song-1'
        ? Promise.resolve({ ...sharedSong, serverId: 'shared' })
        : Promise.resolve(null),
    );
    const t = ((key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key) as TFunction;

    const ok = await enqueueShareSearchPayload({
      srv: 'https://shared.example.com',
      k: 'queue',
      ids: ['song-1', 'missing'],
    }, t);

    expect(ok).toBe(true);
    expect(mocks.enqueue).toHaveBeenCalledWith([
      { id: 'song-1', title: 'Shared Song', serverId: 'shared' },
    ], true);
    expect(mocks.showToast).toHaveBeenCalledWith(
      expect.stringContaining('search.shareQueuedPartial'),
      5000,
      'info',
    );
  });

  it('activateShareSearchServer switches server when lookup succeeds', () => {
    const t = ((key: string) => key) as TFunction;
    expect(activateShareSearchServer('https://shared.example.com', t)).toBe(true);
    expect(mocks.authState.current.setActiveServer).toHaveBeenCalledWith('shared');
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it('activateShareSearchServer toasts when no matching server exists', () => {
    const t = ((key: string) => key) as TFunction;
    expect(activateShareSearchServer('https://unknown.example.com', t)).toBe(false);
    expect(mocks.showToast).toHaveBeenCalledWith(
      'sharePaste.noMatchingServer',
      6000,
      'error',
    );
  });
});
