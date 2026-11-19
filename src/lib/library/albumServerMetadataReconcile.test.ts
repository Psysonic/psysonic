import { describe, expect, it, beforeEach } from 'vitest';
import { onInvoke, invokeMock } from '@/test/mocks/tauri';
import { useLibraryIndexStore } from '@/store/libraryIndexStore';
import { waitFor } from '@testing-library/react';
import { makeSubsonicSong } from '@/test/helpers/factories';
import {
  applyAlbumServerMetadataPatch,
  applyTrackUserRatings,
  diffAlbumServerMetadata,
  diffTrackUserRatings,
  patchAlbumStarToIndexFromReconcile,
  patchTrackRatingsToIndexFromReconcile,
} from './albumServerMetadataReconcile';
import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';

const base: SubsonicAlbum = {
  id: 'al1',
  name: 'Album',
  artist: 'Artist',
  artistId: 'ar1',
  songCount: 1,
  duration: 100,
};

describe('albumServerMetadataReconcile', () => {
  it('returns null when metadata matches', () => {
    const local = { ...base, userRating: 4, starred: '2024-01-01T00:00:00Z' };
    const server = { ...base, userRating: 4, starred: '2024-01-01T00:00:00Z' };
    expect(diffAlbumServerMetadata(local, server)).toBeNull();
  });

  it('detects rating and starred drift', () => {
    const local = { ...base, userRating: 2 };
    const server = { ...base, userRating: 5, starred: '2024-01-01T00:00:00Z' };
    expect(diffAlbumServerMetadata(local, server)).toEqual({
      userRating: 5,
      starred: '2024-01-01T00:00:00Z',
    });
  });

  it('rating-only drift omits starred from patch', () => {
    const local = { ...base, userRating: 2, starred: '2024-01-01T00:00:00Z' };
    const server = { ...base, userRating: 5 };
    expect(diffAlbumServerMetadata(local, server)).toEqual({ userRating: 5 });
  });

  it('applies disc subtitles returned by a fresh getAlbum response', () => {
    const discTitles = [
      { disc: 3, title: 'The demos' },
      { disc: 4, title: 'The demos' },
    ];
    const patch = diffAlbumServerMetadata(base, { ...base, discTitles });

    expect(patch).toEqual({ userRating: 0, discTitles });
    expect(applyAlbumServerMetadataPatch(base, patch!)).toMatchObject({ discTitles });
  });

  it('does not clear cached disc subtitles when the server omits the field', () => {
    const local = { ...base, discTitles: [{ disc: 2, title: 'Bonus tracks' }] };
    expect(diffAlbumServerMetadata(local, base)).toBeNull();
  });

  it('applyAlbumServerMetadataPatch clears unrated stars', () => {
    const patched = applyAlbumServerMetadataPatch(
      { ...base, userRating: 2, starred: 'x' },
      { userRating: 0, starred: undefined },
    );
    expect(patched.userRating).toBeUndefined();
    expect(patched.starred).toBeUndefined();
  });
});

describe('patchAlbumStarToIndexFromReconcile', () => {
  beforeEach(() => {
    useLibraryIndexStore.setState({ masterEnabled: true });
    onInvoke('library_patch_album', () => undefined);
  });

  it('mirrors reconciled star into the index', async () => {
    patchAlbumStarToIndexFromReconcile('s1', 'al1', {
      userRating: 0,
      starred: '2024-01-01T00:00:00Z',
    });
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith('library_patch_album', {
      serverId: 's1',
      albumId: 'al1',
      patch: { starredAt: Date.parse('2024-01-01T00:00:00Z') },
    });
  });

  it('skips index patch for rating-only reconcile', async () => {
    patchAlbumStarToIndexFromReconcile('s1', 'al1', { userRating: 4 });
    await Promise.resolve();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('diffTrackUserRatings', () => {
  it('reports tracks whose server rating differs, with 0 for unrated', () => {
    const local = [
      makeSubsonicSong({ id: 't1', serverId: 's1' }),
      makeSubsonicSong({ id: 't2', serverId: 's1', userRating: 4 }),
      makeSubsonicSong({ id: 't3', serverId: 's1', userRating: 2 }),
    ];
    const server = [
      makeSubsonicSong({ id: 't1', serverId: 's1', userRating: 3 }),
      makeSubsonicSong({ id: 't2', serverId: 's1', userRating: 4 }),
      makeSubsonicSong({ id: 't3', serverId: 's1' }),
    ];
    expect(diffTrackUserRatings('s1', local, server)).toEqual([
      { id: 't1', userRating: 3 },
      { id: 't3', userRating: 0 },
    ]);
  });

  it('ignores tracks missing from the server body or owned by another server', () => {
    const local = [
      makeSubsonicSong({ id: 't1', serverId: 's2' }),
      makeSubsonicSong({ id: 't2', serverId: 's1' }),
    ];
    const server = [makeSubsonicSong({ id: 't1', serverId: 's1', userRating: 5 })];
    expect(diffTrackUserRatings('s1', local, server)).toEqual([]);
  });

  it('matches index tracks that carry no server id', () => {
    const local = [makeSubsonicSong({ id: 't1' })];
    const server = [makeSubsonicSong({ id: 't1', serverId: 's1', userRating: 5 })];
    expect(diffTrackUserRatings('s1', local, server)).toEqual([{ id: 't1', userRating: 5 }]);
  });
});

describe('applyTrackUserRatings', () => {
  it('sets changed ratings, clears unrated ones and keeps other tracks as they are', () => {
    const untouched = makeSubsonicSong({ id: 't3', serverId: 's1', userRating: 1 });
    const songs = [
      makeSubsonicSong({ id: 't1', serverId: 's1' }),
      makeSubsonicSong({ id: 't2', serverId: 's1', userRating: 2 }),
      untouched,
    ];
    const next = applyTrackUserRatings('s1', songs, [
      { id: 't1', userRating: 3 },
      { id: 't2', userRating: 0 },
    ]);
    expect(next.map(song => song.userRating)).toEqual([3, undefined, 1]);
    expect(next[2]).toBe(untouched);
  });

  it('returns the same array when nothing changed', () => {
    const songs = [makeSubsonicSong({ id: 't1', serverId: 's1' })];
    expect(applyTrackUserRatings('s1', songs, [])).toBe(songs);
  });
});

describe('patchTrackRatingsToIndexFromReconcile', () => {
  beforeEach(() => {
    useLibraryIndexStore.setState({ masterEnabled: true });
    onInvoke('library_patch_track', () => undefined);
  });

  it('writes each reconciled rating into the index', async () => {
    patchTrackRatingsToIndexFromReconcile('s1', [
      { id: 't1', userRating: 3 },
      { id: 't2', userRating: 0 },
    ]);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    expect(invokeMock).toHaveBeenCalledWith('library_patch_track', {
      serverId: 's1',
      trackId: 't1',
      patch: { userRating: 3 },
    });
    expect(invokeMock).toHaveBeenCalledWith('library_patch_track', {
      serverId: 's1',
      trackId: 't2',
      patch: { userRating: 0 },
    });
  });
});
