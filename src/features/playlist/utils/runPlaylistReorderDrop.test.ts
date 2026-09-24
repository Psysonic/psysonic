import type { SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { runPlaylistReorderDrop } from './runPlaylistReorderDrop';

const songs = ['a', 'b', 'c', 'd'].map(id => ({ id, title: id }) as SubsonicSong);

/** Row `idx` spans y = idx*40 … idx*40+40, like a 40px tracklist row. */
function rowAt(idx: number): HTMLElement {
  const row = document.createElement('div');
  row.setAttribute('data-track-idx', String(idx));
  row.getBoundingClientRect = () => ({ top: idx * 40, height: 40, bottom: idx * 40 + 40, left: 0, right: 100, width: 100, x: 0, y: idx * 40, toJSON: () => ({}) });
  document.body.appendChild(row);
  return row;
}

/** Same shape `DragDropContext` dispatches: payload + pointer position in `detail`. */
function dropOn(row: HTMLElement, fromIdx: number, clientY: number) {
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
    detail: { data: JSON.stringify({ type: 'playlist_reorder', index: fromIdx }), clientX: 10, clientY },
  }));
  expect(target).toBe(row);
  const saved = savePlaylist.mock.calls[0]?.[0] as SubsonicSong[] | undefined;
  return saved?.map(s => s.id);
}

describe('runPlaylistReorderDrop', () => {
  it('inserts above the target row when the pointer is in its upper half', () => {
    expect(dropOn(rowAt(0), 3, 5)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('inserts below the target row when the pointer is in its lower half', () => {
    expect(dropOn(rowAt(0), 3, 35)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves a track down to just above the hovered row', () => {
    expect(dropOn(rowAt(3), 0, 125)).toEqual(['b', 'c', 'a', 'd']);
  });
});
