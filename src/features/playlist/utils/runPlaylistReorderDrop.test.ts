import type { SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { runPlaylistReorderDrop } from './runPlaylistReorderDrop';

const songs = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id, title: id }) as SubsonicSong);

/** Row `idx` spans y = idx*40 … idx*40+40, like a 40px tracklist row. */
function rowAt(idx: number): HTMLElement {
  const row = document.createElement('div');
  row.setAttribute('data-track-idx', String(idx));
  row.getBoundingClientRect = () => ({ top: idx * 40, height: 40, bottom: idx * 40 + 40, left: 0, right: 100, width: 100, x: 0, y: idx * 40, toJSON: () => ({}) });
  document.body.appendChild(row);
  return row;
}

/** Same shape `DragDropContext` dispatches: payload + pointer position in `detail`. */
function dropOn(row: HTMLElement, payload: Record<string, unknown>, clientY: number) {
  const setSongs = vi.fn((update: SetStateAction<SubsonicSong[]>) => {
    if (typeof update === 'function') update(songs);
  });
  const savePlaylist = vi.fn(async (_next: SubsonicSong[]) => {});
  let target: EventTarget | null = null;
  row.addEventListener('psy-drop', e => {
    target = e.target;
    runPlaylistReorderDrop({ e, songs, savePlaylist, setDropTargetIdx: vi.fn(), setSongs });
  });
  row.dispatchEvent(new CustomEvent('psy-drop', {
    bubbles: true,
    detail: { data: JSON.stringify(payload), clientX: 10, clientY },
  }));
  expect(target).toBe(row);
  const saved = savePlaylist.mock.calls[0]?.[0] as SubsonicSong[] | undefined;
  return saved?.map(s => s.id);
}

const single = (index: number) => ({ type: 'playlist_reorder', index });
const selection = (playlistIndices: number[]) => ({
  type: 'songs',
  tracks: playlistIndices.map(i => ({ id: songs[i].id })),
  playlistIndices,
});

describe('runPlaylistReorderDrop — single row', () => {
  it('inserts above the target row when the pointer is in its upper half', () => {
    expect(dropOn(rowAt(0), single(3), 5)).toEqual(['d', 'a', 'b', 'c', 'e', 'f']);
  });

  it('inserts below the target row when the pointer is in its lower half', () => {
    expect(dropOn(rowAt(0), single(3), 35)).toEqual(['a', 'd', 'b', 'c', 'e', 'f']);
  });

  it('moves a track down to just above the hovered row', () => {
    expect(dropOn(rowAt(3), single(0), 125)).toEqual(['b', 'c', 'a', 'd', 'e', 'f']);
  });

  it('does nothing when dropped on its own edge', () => {
    expect(dropOn(rowAt(2), single(2), 85)).toBeUndefined();
  });
});

describe('runPlaylistReorderDrop — selection block', () => {
  it('moves a selection as one block to the drop line, keeping its order', () => {
    expect(dropOn(rowAt(0), selection([4, 2]), 5)).toEqual(['c', 'e', 'a', 'b', 'd', 'f']);
  });

  it('moves a selection down past the rows it spans', () => {
    expect(dropOn(rowAt(4), selection([0, 1]), 165)).toEqual(['c', 'd', 'a', 'b', 'e', 'f']);
  });

  it('ignores a songs drag that did not start in this playlist', () => {
    expect(dropOn(rowAt(0), { type: 'songs', tracks: [{ id: 'x' }] }, 5)).toBeUndefined();
  });
});
