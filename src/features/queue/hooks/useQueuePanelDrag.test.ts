import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import type { Track } from '@/lib/media/trackTypes';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { makeTracks, seedQueue } from '@/test/helpers/factories';
import { resetPlayerStore } from '@/test/helpers/storeReset';

const resolveAlbum = vi.hoisted(() => vi.fn());
const resolveMediaServerId = vi.hoisted(() => vi.fn((serverId?: string) => serverId ?? null));

vi.mock('@/features/offline', () => ({ resolveAlbum, resolveMediaServerId }));
vi.mock('@/lib/dnd/DragDropContext', () => ({
  registerQueueDragHitTest: () => () => {},
  useDragDrop: () => ({ isDragging: false, startDrag: vi.fn(), payload: null }),
}));

import { useQueuePanelDrag } from './useQueuePanelDrag';

let aside: HTMLElement | null = null;

function setup() {
  aside = document.createElement('aside');
  document.body.appendChild(aside);
  const asideRef = createRef<HTMLElement>();
  asideRef.current = aside;
  const callbacks = {
    moveQueueItems: vi.fn(),
    enqueueAt: vi.fn(),
    removeTrack: vi.fn(),
    removeQueueItems: vi.fn(),
  };
  const hook = renderHook(() => useQueuePanelDrag({ asideRef, isQueueVisible: true, ...callbacks }));
  return { ...hook, aside, ...callbacks };
}

function drop(target: EventTarget, data: object, point?: { clientX: number; clientY: number }) {
  act(() => {
    target.dispatchEvent(new CustomEvent('psy-drop', { detail: { data: JSON.stringify(data), ...point } }));
  });
}

afterEach(() => {
  aside?.remove();
  aside = null;
  resetPlayerStore();
});

describe('useQueuePanelDrag', () => {
  it('resolves an album against its explicit owner and stamps every resolved track', async () => {
    const { aside, enqueueAt, unmount } = setup();
    resolveAlbum.mockResolvedValue({
      album: { id: 'album-1' },
      songs: [{
        id: 'song-1',
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        albumId: 'album-1',
        duration: 100,
        serverId: 'wrong-owner',
      }],
    });

    drop(aside, { type: 'album', id: 'album-1', serverId: 'srv-owner' });

    await waitFor(() => expect(enqueueAt).toHaveBeenCalledOnce());
    expect(resolveMediaServerId).toHaveBeenCalledWith('srv-owner');
    expect(resolveAlbum).toHaveBeenCalledWith('srv-owner', 'album-1');
    expect(enqueueAt).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'song-1', serverId: 'srv-owner' }) as Track,
    ], 0);

    unmount();
  });

  it('moves a dragged row into the gap under the drop line', () => {
    const { aside, result, moveQueueItems } = setup();
    // Drop line below row 2 = the gap before index 3.
    result.current.externalDropTargetRef.current = { idx: 2, before: false };

    drop(aside, { type: 'queue_reorder', index: 1 });

    expect(moveQueueItems).toHaveBeenCalledWith([1], 3);
  });

  it('moves a dragged block together', () => {
    const { aside, result, moveQueueItems } = setup();
    result.current.externalDropTargetRef.current = { idx: 0, before: true };

    drop(aside, { type: 'queue_reorder', index: 3, indices: [1, 3] });

    expect(moveQueueItems).toHaveBeenCalledWith([1, 3], 0);
  });

  it('removes a whole block dragged out of the panel', () => {
    seedQueue(makeTracks(4), { index: 0 });
    const items = usePlayerStore.getState().queueItems;
    const { removeQueueItems, removeTrack, moveQueueItems } = setup();

    drop(document, { type: 'queue_reorder', index: 1, indices: [1, 3] }, { clientX: 500, clientY: 500 });

    expect(removeQueueItems).toHaveBeenCalledWith([items[1], items[3]]);
    expect(removeTrack).not.toHaveBeenCalled();
    expect(moveQueueItems).not.toHaveBeenCalled();
  });

  it('removes a single row dragged out of the panel the way it always did', () => {
    const { removeQueueItems, removeTrack } = setup();

    drop(document, { type: 'queue_reorder', index: 2 }, { clientX: 500, clientY: 500 });

    expect(removeTrack).toHaveBeenCalledWith(2);
    expect(removeQueueItems).not.toHaveBeenCalled();
  });
});
