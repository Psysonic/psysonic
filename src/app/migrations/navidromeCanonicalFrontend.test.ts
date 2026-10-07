import { beforeEach, describe, expect, it } from 'vitest';
import { canonicalNavidromeId } from '@/lib/server/navidromeCanonicalId';
import {
  rewriteNavidromeCanonicalFrontendState,
  verifyNavidromeCanonicalFrontendState,
} from './navidromeCanonicalFrontend';

const LEGACY = 'e3b7fc2ae9447bbec37a13bf916e3cf6';
const CANONICAL = '6VHl3uR4kss6sUPKA8Cwnk';
const PLAYLIST_LEGACY = '123e4567-e89b-12d3-a456-426614174000';
const PLAYLIST_CANONICAL = canonicalNavidromeId(PLAYLIST_LEGACY);
const RADIO_LEGACY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const RADIO_CANONICAL = canonicalNavidromeId(RADIO_LEGACY);

const scope = {
  serverIndexKey: 'music.test',
  profileIds: ['profile-a', 'profile-b'],
  profileServerIndexKeys: {
    'profile-a': 'music.test',
    'profile-b': 'music.test',
    other: 'other.test',
  },
};

function persisted(state: Record<string, unknown>, version = 0): string {
  return JSON.stringify({ state, version });
}

describe('rewriteNavidromeCanonicalFrontendState', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('psysonic-auth', persisted({
      activeServerId: 'profile-a',
      servers: [
        { id: 'profile-a', url: 'https://music.test' },
        { id: 'profile-b', url: 'https://music.test' },
        { id: 'other', url: 'https://other.test' },
      ],
      musicFolders: [{ id: LEGACY, name: 'All' }, { id: CANONICAL, name: '' }],
      musicFoldersByServer: {
        'profile-a': [{ id: LEGACY, name: 'All' }, { id: CANONICAL, name: '' }],
        'profile-b': [{ id: LEGACY, name: 'All' }],
      },
      libraryBrowseSelectionByServer: { 'profile-a': [LEGACY, CANONICAL] },
      musicLibraryFilterByServer: { 'profile-a': LEGACY },
      musicLibrarySelectionByServer: { 'profile-a': [LEGACY, CANONICAL] },
      skipStarManualSkipCountsByKey: {
        [`profile-a\u001f${LEGACY}`]: 2,
        [`profile-a\u001f${CANONICAL}`]: 4,
        [`other\u001f${LEGACY}`]: 3,
        malformed: 8,
        [`removed\u001f${LEGACY}`]: 9,
      },
    }, 1));
    localStorage.setItem('psysonic-player', persisted({
      queueServerId: 'music.test',
      queueItems: [{ serverId: 'music.test', trackId: LEGACY }],
      currentTrack: {
        id: LEGACY,
        albumId: LEGACY,
        artistId: LEGACY,
        coverArt: `mf-${LEGACY}`,
        serverId: 'music.test',
      },
    }));
    localStorage.setItem('psysonic_shuffle_mode', JSON.stringify({
      enabled: true,
      originalOrder: [LEGACY, JSON.stringify(['music.test', LEGACY])],
    }));
    localStorage.setItem('psysonic-local-playback', persisted({
      entries: {
        [`music.test:${LEGACY}`]: {
          serverIndexKey: 'music.test',
          trackId: LEGACY,
          localPath: `/cache/${LEGACY}.flac`,
          layoutFingerprint: 'layout',
          sizeBytes: 1,
          tier: 'library',
          cachedAt: 2,
          pinSource: { kind: 'album', sourceId: LEGACY },
          pinSources: [
            { kind: 'artist', sourceId: LEGACY },
            { kind: 'playlist', sourceId: PLAYLIST_LEGACY },
          ],
          suffix: 'flac',
        },
      },
    }, 1));
    localStorage.setItem('psysonic-offline', persisted({
      tracks: {
        [`profile-a:${LEGACY}`]: {
          id: LEGACY,
          serverId: 'profile-a',
          localPath: `/cache/${LEGACY}.flac`,
          title: 'Track',
          artist: 'Artist',
          album: 'Album',
          albumId: LEGACY,
          artistId: LEGACY,
          suffix: 'flac',
          duration: 60,
          coverArt: `al-${LEGACY}`,
          cachedAt: '2026-08-01T00:00:00.000Z',
        },
      },
      albums: {
        [`music.test:${LEGACY}`]: {
          id: LEGACY,
          serverId: 'music.test',
          name: 'Album',
          artist: 'Artist',
          coverArt: `al-${LEGACY}_abcdef`,
          trackIds: [LEGACY],
          type: 'album',
        },
        [`profile-a:playlist-${PLAYLIST_LEGACY}`]: {
          id: PLAYLIST_LEGACY,
          serverId: 'profile-a',
          name: 'Playlist pin',
          artist: '',
          coverArt: `pl-${PLAYLIST_LEGACY}`,
          trackIds: [LEGACY],
          type: 'playlist',
        },
      },
    }));
    localStorage.setItem('psysonic-hot-cache', persisted({ entries: { [LEGACY]: {} } }));
    localStorage.setItem('psysonic_device_sync', persisted({
      targetDir: '/device',
      sources: [
        { type: 'album', id: LEGACY, name: 'Album', serverIndexKey: 'music.test' },
        { type: 'album', id: CANONICAL, name: '', note: 'canonical metadata', serverIndexKey: 'music.test' },
        { type: 'playlist', id: PLAYLIST_LEGACY, name: 'Playlist', serverIndexKey: 'profile-a' },
      ],
      pendingDeletion: [JSON.stringify(['profile-a', 'playlist', PLAYLIST_LEGACY])],
      legacySources: [{ type: 'artist', id: LEGACY, name: 'Unassigned' }],
    }, 2));
    localStorage.setItem('psysonic_playlists_recent', persisted({
      playlists: [{ id: PLAYLIST_LEGACY, serverId: 'profile-a', name: 'Playlist', coverArt: `pl-${PLAYLIST_LEGACY}` }],
      recentIds: [`profile-a:${PLAYLIST_LEGACY}`],
      lastModified: { [`profile-a:${PLAYLIST_LEGACY}`]: 10 },
    }, 1));
    localStorage.setItem('psysonic_playlist_folders', persisted({
      byServer: {
        'profile-a': {
          folders: [{ id: 'local-folder', name: 'Folder' }],
          assignments: { [PLAYLIST_LEGACY]: 'local-folder' },
        },
      },
    }));
    localStorage.setItem('psysonic_radio_favorites', JSON.stringify([`profile-a:${RADIO_LEGACY}`]));
    localStorage.setItem('psysonic_radio_order', JSON.stringify([`profile-a:${RADIO_LEGACY}`]));
    localStorage.setItem(
      `psy_new_releases_unread_seen_v2:${JSON.stringify([['profile-a', [LEGACY]]])}`,
      JSON.stringify([LEGACY]),
    );
    localStorage.setItem('psysonic_because_anchor_history:music.test', JSON.stringify([LEGACY]));
  });

  it('rewrites every declared raw persistence surface idempotently before hydration', () => {
    rewriteNavidromeCanonicalFrontendState(scope);
    rewriteNavidromeCanonicalFrontendState(scope);

    const auth = JSON.parse(localStorage.getItem('psysonic-auth') ?? '{}').state;
    expect(auth.musicFolders).toEqual([{ id: CANONICAL, name: 'All' }]);
    expect(auth.musicFoldersByServer['profile-a']).toEqual([{ id: CANONICAL, name: 'All' }]);
    expect(auth.musicFoldersByServer['profile-b'][0].id).toBe(CANONICAL);
    expect(auth.libraryBrowseSelectionByServer['profile-a']).toEqual([CANONICAL]);
    expect(auth.musicLibrarySelectionByServer['profile-a']).toEqual([CANONICAL]);
    expect(auth.skipStarManualSkipCountsByKey).toEqual({
      [`profile-a\u001f${CANONICAL}`]: 4,
      [`other\u001f${LEGACY}`]: 3,
    });

    const player = JSON.parse(localStorage.getItem('psysonic-player') ?? '{}').state;
    expect(player.queueItems[0].trackId).toBe(CANONICAL);
    expect(player.currentTrack).toMatchObject({
      id: CANONICAL,
      albumId: CANONICAL,
      artistId: CANONICAL,
      coverArt: `mf-${CANONICAL}`,
    });
    expect(JSON.parse(localStorage.getItem('psysonic_shuffle_mode') ?? '{}').originalOrder).toEqual([
      CANONICAL,
      JSON.stringify(['music.test', CANONICAL]),
    ]);

    const local = JSON.parse(localStorage.getItem('psysonic-local-playback') ?? '{}').state.entries;
    expect(local[`music.test:${CANONICAL}`]).toMatchObject({
      trackId: CANONICAL,
      localPath: `/cache/${CANONICAL}.flac`,
      pinSource: { sourceId: CANONICAL },
    });
    expect(local[`music.test:${CANONICAL}`].pinSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'album', sourceId: CANONICAL }),
      expect.objectContaining({ kind: 'artist', sourceId: CANONICAL }),
      expect.objectContaining({ kind: 'playlist', sourceId: PLAYLIST_CANONICAL }),
    ]));
    const offline = JSON.parse(localStorage.getItem('psysonic-offline') ?? '{}').state.albums;
    expect(offline[`music.test:${CANONICAL}`]).toMatchObject({
      id: CANONICAL,
      trackIds: [CANONICAL],
      coverArt: `al-${CANONICAL}_abcdef`,
    });
    expect(offline[`music.test:${PLAYLIST_CANONICAL}`]).toMatchObject({
      id: PLAYLIST_CANONICAL,
      serverId: 'music.test',
      trackIds: [CANONICAL],
      coverArt: `pl-${PLAYLIST_CANONICAL}`,
      type: 'playlist',
    });
    const offlineTracks = JSON.parse(localStorage.getItem('psysonic-offline') ?? '{}').state.tracks;
    expect(offlineTracks[`music.test:${CANONICAL}`]).toMatchObject({
      id: CANONICAL,
      serverId: 'music.test',
      albumId: CANONICAL,
      artistId: CANONICAL,
      localPath: `/cache/${CANONICAL}.flac`,
    });

    const device = JSON.parse(localStorage.getItem('psysonic_device_sync') ?? '{}').state;
    expect(device.sources).toHaveLength(2);
    expect(device.sources[0]).toMatchObject({
      type: 'album', id: CANONICAL, name: 'Album', note: 'canonical metadata',
    });
    expect(device.sources[1]).toMatchObject({
      type: 'playlist', id: PLAYLIST_CANONICAL, serverIndexKey: 'music.test',
    });
    expect(device.pendingDeletion).toEqual([
      JSON.stringify(['music.test', 'playlist', PLAYLIST_CANONICAL]),
    ]);
    expect(device.legacySources[0].id).toBe(LEGACY);
    const playlists = JSON.parse(localStorage.getItem('psysonic_playlists_recent') ?? '{}').state;
    expect(playlists.playlists[0]).toMatchObject({
      id: PLAYLIST_CANONICAL,
      coverArt: `pl-${PLAYLIST_CANONICAL}`,
    });
    expect(playlists.recentIds).toEqual([`profile-a:${PLAYLIST_CANONICAL}`]);
    expect(playlists.lastModified).toEqual({ [`profile-a:${PLAYLIST_CANONICAL}`]: 10 });
    expect(JSON.parse(localStorage.getItem('psysonic_playlist_folders') ?? '{}').state.byServer['profile-a'].assignments)
      .toEqual({ [PLAYLIST_CANONICAL]: 'local-folder' });
    expect(JSON.parse(localStorage.getItem('psysonic_radio_favorites') ?? '[]'))
      .toEqual([`profile-a:${RADIO_CANONICAL}`]);
    expect(JSON.parse(localStorage.getItem('psysonic_radio_order') ?? '[]'))
      .toEqual([`profile-a:${RADIO_CANONICAL}`]);
    expect(JSON.parse(localStorage.getItem(
      `psy_new_releases_unread_seen_v2:${JSON.stringify([['profile-a', [CANONICAL]]])}`,
    ) ?? '[]')).toEqual([CANONICAL]);
    expect(localStorage.getItem('psysonic-hot-cache')).toBeNull();
    expect(localStorage.getItem('psysonic-local-playback-migrated-v1')).toBe('1');
    expect(localStorage.getItem('psysonic_because_anchor_history:music.test')).toBeNull();
  });

  it('accepts derived history caches recreated with canonical IDs after migration', () => {
    rewriteNavidromeCanonicalFrontendState(scope);
    const cacheScope = JSON.stringify([
      ['music.test', [CANONICAL]],
      ['other.test', [LEGACY]],
    ]);
    localStorage.setItem(
      `psysonic_because_anchor_history:${cacheScope}`,
      JSON.stringify([`music.test:${CANONICAL}`, `other.test:${LEGACY}`]),
    );
    localStorage.setItem(
      `psysonic_because_picks:${cacheScope}`,
      JSON.stringify([`profile-a:${CANONICAL}`]),
    );

    expect(() => verifyNavidromeCanonicalFrontendState(localStorage, scope)).not.toThrow();
  });

  it('rejects recreated derived history caches that still contain legacy IDs', () => {
    rewriteNavidromeCanonicalFrontendState(scope);
    const cacheScope = JSON.stringify([['music.test', [CANONICAL]]]);
    localStorage.setItem(
      `psysonic_because_anchor_history:${cacheScope}`,
      JSON.stringify([`music.test:${LEGACY}`]),
    );

    expect(() => verifyNavidromeCanonicalFrontendState(localStorage, scope))
      .toThrow('Legacy psysonic_because_anchor_history:');
  });

  it('merges conflicting local playback destinations while retaining the original state', () => {
    localStorage.removeItem('psysonic-offline');
    localStorage.setItem('psysonic-local-playback', persisted({
      entries: {
        legacy: {
          serverIndexKey: 'music.test', trackId: LEGACY, localPath: `/cache/${LEGACY}.flac`,
          layoutFingerprint: 'a', sizeBytes: 1, tier: 'library', cachedAt: 1, suffix: 'flac',
        },
        canonical: {
          serverIndexKey: 'music.test', trackId: CANONICAL, localPath: `/cache/other.flac`,
          layoutFingerprint: 'b', sizeBytes: 1, tier: 'library', cachedAt: 2, suffix: 'flac',
        },
      },
    }, 1));

    const original = localStorage.getItem('psysonic-local-playback');
    expect(() => rewriteNavidromeCanonicalFrontendState(scope)).not.toThrow();
    const entries = JSON.parse(localStorage.getItem('psysonic-local-playback')!).state.entries;
    expect(Object.keys(entries)).toEqual([`music.test:${CANONICAL}`]);
    expect(entries[`music.test:${CANONICAL}`].localPath).toBe('/cache/other.flac');
    const recoveryKey = 'psysonic-local-playback-collision-recovery-v1:music.test';
    const recovery = localStorage.getItem(recoveryKey);
    expect(JSON.parse(recovery!).localPlayback).toBe(original);
    rewriteNavidromeCanonicalFrontendState(scope);
    expect(localStorage.getItem(recoveryKey)).toBe(recovery);
    expect(localStorage.getItem('psysonic-local-playback-migrated-v1')).toBe('1');
  });

  it('recovers 335 profile/address aliases without mixing file metadata or losing pins', () => {
    localStorage.removeItem('psysonic-offline');
    const entries: Record<string, unknown> = {};
    for (let index = 1; index <= 335; index += 1) {
      const trackId = index.toString(16).padStart(32, '0');
      entries[`profile-a:${trackId}`] = {
        serverIndexKey: 'profile-a', trackId, localPath: `/offline/profile/${index}.mp3`,
        tier: 'library', cachedAt: 999, lastPlayedAt: 20, suffix: 'mp3', sizeBytes: 1,
        pinSource: { kind: 'playlist', sourceId: LEGACY },
      };
      entries[`music.test:${trackId}`] = {
        serverIndexKey: 'music.test', trackId, localPath: `/offline/server/${index}.flac`,
        tier: 'library', cachedAt: 1, lastPlayedAt: 10, suffix: 'flac', sizeBytes: 2,
        originalBytesVerified: true,
        pinSource: { kind: 'album', sourceId: LEGACY },
      };
    }
    localStorage.setItem('psysonic-local-playback', persisted({ entries }, 1));
    rewriteNavidromeCanonicalFrontendState(scope);
    const result = JSON.parse(localStorage.getItem('psysonic-local-playback')!).state.entries;
    expect(Object.keys(result)).toHaveLength(335);
    for (const entry of Object.values(result) as Array<Record<string, unknown>>) {
      expect(entry.localPath).toMatch(/\/server\/\d+\.flac$/);
      expect(entry.suffix).toBe('flac');
      expect(entry.sizeBytes).toBe(2);
      expect(entry.originalBytesVerified).toBe(true);
      expect(entry.lastPlayedAt).toBe(20);
      expect(entry.pinSources).toHaveLength(2);
    }
    const once = localStorage.getItem('psysonic-local-playback');
    rewriteNavidromeCanonicalFrontendState(scope);
    expect(localStorage.getItem('psysonic-local-playback')).toBe(once);
  });

  it('does not rewrite live state if the recovery snapshot cannot be stored', () => {
    localStorage.removeItem('psysonic-offline');
    localStorage.setItem('psysonic-local-playback', persisted({
      entries: {
        legacy: {
          serverIndexKey: 'music.test', trackId: LEGACY, localPath: `/cache/${LEGACY}.flac`,
          layoutFingerprint: 'a', sizeBytes: 1, tier: 'library', cachedAt: 1, suffix: 'flac',
        },
        canonical: {
          serverIndexKey: 'music.test', trackId: CANONICAL, localPath: `/cache/other.flac`,
          layoutFingerprint: 'b', sizeBytes: 1, tier: 'library', cachedAt: 2, suffix: 'flac',
        },
      },
    }, 1));
    const original = localStorage.getItem('psysonic-local-playback');
    const originalAuth = localStorage.getItem('psysonic-auth');
    const storage = {
      get length() { return localStorage.length; },
      key: (index: number) => localStorage.key(index),
      getItem: (key: string) => localStorage.getItem(key),
      removeItem: (key: string) => localStorage.removeItem(key),
      setItem: (key: string, value: string) => {
        if (!key.startsWith('psysonic-local-playback-collision-recovery-v1:')) {
          localStorage.setItem(key, value);
        }
      },
    };
    expect(() => rewriteNavidromeCanonicalFrontendState(scope, storage))
      .toThrow('Local playback recovery snapshot could not be persisted');
    expect(localStorage.getItem('psysonic-local-playback')).toBe(original);
    expect(localStorage.getItem('psysonic-auth')).toBe(originalAuth);
  });

  it('writes no recovery snapshot when no local playback paths collide', () => {
    rewriteNavidromeCanonicalFrontendState(scope);
    expect(localStorage.getItem('psysonic-local-playback-collision-recovery-v1:music.test')).toBeNull();
    expect(localStorage.getItem('psysonic-local-playback-migrated-v1')).toBe('1');
  });

  it('retains the original state when a legacy offline record points at another file', () => {
    localStorage.setItem('psysonic-local-playback', persisted({
      entries: {
        [`music.test:${CANONICAL}`]: {
          serverIndexKey: 'music.test', trackId: CANONICAL, localPath: '/cache/current.flac',
          layoutFingerprint: 'a', sizeBytes: 1, tier: 'library', cachedAt: 2, suffix: 'flac',
        },
      },
    }, 1));
    const originalOffline = localStorage.getItem('psysonic-offline');
    rewriteNavidromeCanonicalFrontendState(scope);
    const recovery = localStorage.getItem('psysonic-local-playback-collision-recovery-v1:music.test');
    expect(JSON.parse(recovery!).offline).toBe(originalOffline);
  });

  it('migrates a store too large to copy when no local playback paths collide', () => {
    localStorage.removeItem('psysonic-offline');
    const entries: Record<string, unknown> = {};
    for (let index = 1; index <= 200; index += 1) {
      const trackId = index.toString(16).padStart(32, '0');
      entries[`music.test:${trackId}`] = {
        serverIndexKey: 'music.test', trackId, localPath: `/offline/server/${index}.flac`,
        layoutFingerprint: `artist=Artist|album=Album|title=Track ${index}|stem=${index}`,
        tier: 'library', cachedAt: 1, suffix: 'flac', sizeBytes: 2,
      };
    }
    localStorage.setItem('psysonic-local-playback', persisted({ entries }, 1));
    const stored = () => Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!)
      .reduce((total, key) => total + key.length + localStorage.getItem(key)!.length, 0);
    // Room for the rewrite, but not for a second copy of the local playback store.
    const quota = stored() + localStorage.getItem('psysonic-local-playback')!.length / 2;
    const storage = {
      get length() { return localStorage.length; },
      key: (index: number) => localStorage.key(index),
      getItem: (key: string) => localStorage.getItem(key),
      removeItem: (key: string) => localStorage.removeItem(key),
      setItem: (key: string, value: string) => {
        const previous = localStorage.getItem(key);
        const next = stored() - (previous === null ? 0 : key.length + previous.length) + key.length + value.length;
        if (next > quota) throw new DOMException('quota', 'QuotaExceededError');
        localStorage.setItem(key, value);
      },
    };
    expect(() => rewriteNavidromeCanonicalFrontendState(scope, storage)).not.toThrow();
    const result = JSON.parse(localStorage.getItem('psysonic-local-playback')!).state.entries;
    expect(Object.keys(result)).toHaveLength(200);
  });

  it('preserves a valid local playback entry owned by a removed server', () => {
    localStorage.setItem('psysonic-local-playback', persisted({
      entries: {
        [`removed-profile:${LEGACY}`]: {
          serverIndexKey: 'removed-profile', trackId: LEGACY, localPath: `/cache/${LEGACY}.flac`,
          layoutFingerprint: 'a', sizeBytes: 1, tier: 'library', cachedAt: 1, suffix: 'flac',
        },
      },
    }, 1));

    rewriteNavidromeCanonicalFrontendState(scope);

    const entries = JSON.parse(localStorage.getItem('psysonic-local-playback') ?? '{}').state.entries;
    expect(entries[`removed-profile:${LEGACY}`]).toEqual({
      serverIndexKey: 'removed-profile', trackId: LEGACY, localPath: `/cache/${LEGACY}.flac`,
      layoutFingerprint: 'a', sizeBytes: 1, tier: 'library', cachedAt: 1, suffix: 'flac',
    });
  });

  it('fails closed when a local playback entry is structurally malformed', () => {
    localStorage.setItem('psysonic-local-playback', persisted({
      entries: {
        malformed: {
          serverIndexKey: 'removed-profile', localPath: `/cache/${LEGACY}.flac`,
          layoutFingerprint: 'a', sizeBytes: 1, tier: 'library', cachedAt: 1, suffix: 'flac',
        },
      },
    }, 1));

    expect(() => rewriteNavidromeCanonicalFrontendState(scope))
      .toThrow('Malformed persisted state in psysonic-local-playback');
    expect(localStorage.getItem('psysonic-local-playback-migrated-v1')).toBeNull();
  });

  it('imports durable legacy offline tracks before disabling the hydration importer', () => {
    localStorage.removeItem('psysonic-local-playback');

    rewriteNavidromeCanonicalFrontendState(scope);

    const entries = JSON.parse(localStorage.getItem('psysonic-local-playback') ?? '{}').state.entries;
    expect(entries[`music.test:${CANONICAL}`]).toMatchObject({
      serverIndexKey: 'music.test',
      trackId: CANONICAL,
      localPath: `/cache/${CANONICAL}.flac`,
      tier: 'library',
    });
    expect(localStorage.getItem('psysonic-local-playback-migrated-v1')).toBe('1');
  });

  it('invalidates legacy hot-cache persistence without promoting ephemeral entries', () => {
    localStorage.removeItem('psysonic-local-playback');
    localStorage.setItem('psysonic-offline', persisted({ albums: {} }));
    localStorage.setItem('psysonic-hot-cache', persisted({
      entries: {
        [`profile-a:${LEGACY}`]: {
          localPath: `/hot/${LEGACY}.mp3`, sizeBytes: 10, cachedAt: 1,
        },
      },
    }));

    rewriteNavidromeCanonicalFrontendState(scope);

    expect(localStorage.getItem('psysonic-local-playback')).toBeNull();
    expect(localStorage.getItem('psysonic-hot-cache')).toBeNull();
    expect(localStorage.getItem('psysonic-local-playback-migrated-v1')).toBe('1');
  });
});
