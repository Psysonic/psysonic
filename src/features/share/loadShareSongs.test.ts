import { describe, expect, it, vi } from 'vitest';
import type { SubsonicShare } from '@/lib/api/subsonicSharing';

const getAlbumForServer = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/subsonicLibrary', () => ({ getAlbumForServer }));

import { loadShareSongs } from '@/features/share/loadShareSongs';

describe('loadShareSongs', () => {
  it('limits concurrent album expansion while preserving entry order', async () => {
    let active = 0;
    let maxActive = 0;
    getAlbumForServer.mockImplementation(async (_serverId: string, albumId: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active -= 1;
      return {
        songs: [{ id: `song-${albumId}`, title: albumId, artist: '', album: '', albumId, duration: 0 }],
      };
    });
    const share = {
      id: 'share-1',
      url: 'https://music.test/share/1',
      entry: Array.from({ length: 12 }, (_, index) => ({
        id: `album-${index}`,
        isDir: true,
        songCount: 1,
      })),
    } satisfies SubsonicShare;

    const result = await loadShareSongs('srv-a', share);

    expect(getAlbumForServer).toHaveBeenCalledTimes(12);
    expect(maxActive).toBe(4);
    expect(result.failedEntries).toBe(0);
    expect(result.songs.map(song => song.id)).toEqual(
      Array.from({ length: 12 }, (_, index) => `song-album-${index}`),
    );
  });
});
