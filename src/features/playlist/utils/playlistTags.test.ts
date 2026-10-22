import { describe, expect, it } from 'vitest';
import {
  allPlaylistTags,
  collectPlaylistTags,
  filterPlaylistsByTags,
  normalizePlaylistTagName,
  playlistTagKey,
  playlistTagsFor,
  type PlaylistTagsByServer,
} from '@/features/playlist/utils/playlistTags';

const byServer: PlaylistTagsByServer = {
  s1: {
    p1: ['Chill', 'Summer'],
    p2: ['Chill'],
    p3: ['Workout'],
  },
  s2: {
    p1: ['chill', 'Road'],
  },
};

const pl = (id: string, serverId?: string) => ({ id, serverId });

describe('playlistTags', () => {
  it('normalizes names and compares them case-insensitively', () => {
    expect(normalizePlaylistTagName('  Late   night ')).toBe('Late night');
    expect(normalizePlaylistTagName('   ')).toBe('');
    expect(playlistTagKey(' CHILL ')).toBe(playlistTagKey('chill'));
  });

  it('keys assignments per server, so equal playlist ids do not share tags', () => {
    expect(playlistTagsFor(byServer, 's1', 'p1')).toEqual(['Chill', 'Summer']);
    expect(playlistTagsFor(byServer, 's2', 'p1')).toEqual(['chill', 'Road']);
    expect(playlistTagsFor(byServer, undefined, 'p1')).toEqual([]);
  });

  it('lists the vocabulary once per tag, sorted, keeping the first spelling', () => {
    expect(allPlaylistTags(byServer)).toEqual(['Chill', 'Road', 'Summer', 'Workout']);
  });

  it('collects only the tags the given playlists carry', () => {
    expect(collectPlaylistTags(byServer, [pl('p2', 's1'), pl('p1', 's2')])).toEqual(['Chill', 'Road']);
    expect(collectPlaylistTags(byServer, [pl('p1')])).toEqual([]);
  });

  it('keeps only playlists carrying every active tag', () => {
    const playlists = [pl('p1', 's1'), pl('p2', 's1'), pl('p3', 's1'), pl('p1', 's2')];

    expect(filterPlaylistsByTags(playlists, byServer, [])).toBe(playlists);
    expect(filterPlaylistsByTags(playlists, byServer, ['chill']))
      .toEqual([pl('p1', 's1'), pl('p2', 's1'), pl('p1', 's2')]);
    expect(filterPlaylistsByTags(playlists, byServer, ['chill', 'summer'])).toEqual([pl('p1', 's1')]);
    expect(filterPlaylistsByTags(playlists, byServer, ['chill', 'workout'])).toEqual([]);
  });
});
