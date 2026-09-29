import { describe, expect, it, vi } from 'vitest';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { startPlaylistRowDrag } from './startPlaylistRowDrag';

const songs = ['a', 'b', 'c', 'd'].map(id => ({ id, title: id, artist: 'x', album: 'y', duration: 1 }) as SubsonicSong);

function dragPayload(idx: number, selected: string[], isFiltered = false) {
  const startDrag = vi.fn();
  startPlaylistRowDrag({
    me: { clientX: 0, clientY: 0 } as MouseEvent,
    idx,
    songs,
    selectedIds: new Set(selected),
    isFiltered,
    startDrag,
  });
  return JSON.parse(startDrag.mock.calls[0][0].data);
}

describe('startPlaylistRowDrag', () => {
  it('carries the playlist positions of a selection alongside its tracks', () => {
    const payload = dragPayload(3, ['d', 'b']);
    expect(payload.type).toBe('songs');
    expect(payload.playlistIndices).toEqual([1, 3]);
    expect(payload.tracks.map((t: { id: string }) => t.id)).toEqual(['b', 'd']);
  });

  it('drags a single row as a reorder when it is not part of a selection', () => {
    expect(dragPayload(2, ['a', 'b'])).toEqual({ type: 'playlist_reorder', index: 2 });
  });

  it('drags a single song to the queue in a sorted or filtered view', () => {
    expect(dragPayload(2, ['c', 'd'], true).type).toBe('song');
  });
});
