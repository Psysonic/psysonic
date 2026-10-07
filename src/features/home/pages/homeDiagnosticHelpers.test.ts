import { describe, expect, it, vi } from 'vitest';
import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';
import type { HomeFeedSnapshot } from '@/features/home/store/homeFeedCache';
import {
  homeSnapshotForEnabledCoverWarm,
  preserveDisabledHomeSections,
  reportCachedHomeDiagnostics,
  type MainstageEnabledSections,
} from '@/features/home/pages/homeDiagnosticHelpers';

function album(id: string): SubsonicAlbum {
  return { id, name: id, artist: 'Artist', artistId: 'artist', songCount: 1, duration: 1 };
}

function snapshot(prefix: string): HomeFeedSnapshot {
  return {
    scopeKey: 'scope',
    scopeVersion: 1,
    savedAt: 1,
    offsets: {
      starred: { a: 1 },
      recent: { offset: 1, hasMore: false },
      random: { a: 1 },
      mostPlayed: { a: 1 },
      recentlyPlayed: { offset: 1, hasMore: false },
    },
    starred: [album(`${prefix}-starred`)],
    recent: [album(`${prefix}-recent`)],
    random: [album(`${prefix}-random`)],
    heroAlbums: [album(`${prefix}-hero`)],
    mostPlayed: [album(`${prefix}-most`) ],
    recentlyPlayed: [album(`${prefix}-played`)],
    randomArtists: [{ id: `${prefix}-artist`, name: 'Artist' }],
    discoverSongs: [{
      id: `${prefix}-song`,
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      albumId: 'album',
      duration: 1,
    }],
  };
}

const allEnabled: MainstageEnabledSections = {
  hero: true,
  continueListening: true,
  recent: true,
  becauseYouLike: true,
  discover: true,
  discoverSongs: true,
  discoverArtists: true,
  recentlyPlayed: true,
  starred: true,
  mostPlayed: true,
  losslessAlbums: true,
};

describe('homeDiagnosticHelpers', () => {
  it('keeps prior cached data for sections disabled during a diagnostic pass', () => {
    const previous = snapshot('old');
    const fresh = snapshot('new');
    const result = preserveDisabledHomeSections(fresh, previous, {
      ...allEnabled,
      hero: false,
      starred: false,
    });

    expect(result.heroAlbums[0].id).toBe('old-hero');
    expect(result.starred[0].id).toBe('old-starred');
    expect(result.random[0].id).toBe('new-random');
    expect(result.offsets.starred).toBe(previous.offsets.starred);
  });

  it('removes disabled section items from the cover-warming snapshot', () => {
    const result = homeSnapshotForEnabledCoverWarm(snapshot('warm'), {
      ...allEnabled,
      discoverSongs: false,
      recentlyPlayed: false,
    });

    expect(result.discoverSongs).toEqual([]);
    expect(result.recentlyPlayed).toEqual([]);
    expect(result.heroAlbums).toHaveLength(1);
  });

  it('reports cached blocks without reporting disabled ones', () => {
    const finish = vi.fn();
    reportCachedHomeDiagnostics(snapshot('cache'), id => id !== 'discover', finish);

    expect(finish).not.toHaveBeenCalledWith('discover', expect.anything());
    expect(finish).toHaveBeenCalledWith('hero', {
      status: 'ready',
      durationMs: 0,
      itemCount: 1,
      detail: 'cache',
    });
  });
});
