import type React from 'react';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { moveBlockToGap } from '@/lib/util/listReorder';

export interface RunPlaylistReorderDropDeps {
  e: Event;
  songs: SubsonicSong[];
  savePlaylist: (next: SubsonicSong[], prevCount?: number) => Promise<void>;
  setDropTargetIdx: React.Dispatch<React.SetStateAction<{ idx: number; before: boolean } | null>>;
  setSongs: React.Dispatch<React.SetStateAction<SubsonicSong[]>>;
}

/**
 * Rows a drag moves inside this playlist: one row for `playlist_reorder`, the
 * selection for a `songs` drag that started here (`playlistIndices`). `null` for
 * every other payload, including `songs` dragged in from elsewhere.
 */
function reorderIndices(parsed: { type?: unknown; index?: unknown; playlistIndices?: unknown }): number[] | null {
  if (parsed.type === 'playlist_reorder') {
    return typeof parsed.index === 'number' ? [parsed.index] : null;
  }
  if (parsed.type === 'songs' && Array.isArray(parsed.playlistIndices)) {
    const indices = parsed.playlistIndices.filter((i): i is number => Number.isInteger(i));
    return indices.length > 0 ? indices : null;
  }
  return null;
}

export function runPlaylistReorderDrop(deps: RunPlaylistReorderDropDeps): void {
  const { e, songs, savePlaylist, setDropTargetIdx, setSongs } = deps;
  const detail = (e as CustomEvent).detail;
  if (!detail?.data) return;
  let parsed: { type?: unknown; index?: unknown; playlistIndices?: unknown };
  try { parsed = JSON.parse(detail.data); } catch { return; }
  const indices = reorderIndices(parsed);
  if (!indices) return;

  setDropTargetIdx(null);

  // Determine the gap from the event target row
  const target = (e.target as HTMLElement).closest('[data-track-idx]');
  let gapIndex = songs.length;
  if (target) {
    const targetIdx = parseInt(target.getAttribute('data-track-idx') ?? '', 10);
    const rect = target.getBoundingClientRect();
    // `DragDropContext` puts the pointer position into `detail`; a CustomEvent has no clientY of its own.
    const cursorY = typeof detail.clientY === 'number' ? detail.clientY : rect.top + rect.height / 2;
    const before = cursorY < rect.top + rect.height / 2;
    gapIndex = before ? targetIdx : targetIdx + 1;
  }

  if (!moveBlockToGap(songs, indices, gapIndex)) return;

  setSongs(prev => {
    const next = moveBlockToGap(prev, indices, gapIndex);
    if (!next) return prev;
    savePlaylist(next);
    return next;
  });
}
