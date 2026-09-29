import React, { useEffect, useRef, useState } from 'react';
import { resolveAlbum, resolveMediaServerId } from '@/features/offline';
import { songToTrack } from '@/lib/media/songToTrack';
import { useDragDrop, registerQueueDragHitTest } from '@/lib/dnd/DragDropContext';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import type { QueueItemRef, Track } from '@/lib/media/trackTypes';
import { queueReorderIndices } from '@/features/queue/utils/queueReorderPayload';

/** Drag types that may be dropped into the queue panel. */
const QUEUE_DROP_TYPES = new Set(['song', 'album', 'queue_reorder']);

interface Args {
  asideRef: React.RefObject<HTMLElement | null>;
  isQueueVisible: boolean;
  moveQueueItems: (indices: readonly number[], gapIndex: number) => void;
  enqueueAt: (tracks: Track[], idx: number) => void;
  removeTrack: (idx: number) => void;
  removeQueueItems: (refs: readonly QueueItemRef[]) => void;
}

/** Queue drag/drop wiring: hit-test registration, psy-drop dispatch for drops
 *  inside the panel, removal-on-drop-outside, and visual feedback refs. */
export function useQueuePanelDrag({
  asideRef, isQueueVisible, moveQueueItems, enqueueAt, removeTrack, removeQueueItems,
}: Args) {
  const psyDragFromIdxRef = useRef<number | null>(null);
  const [externalDropTarget, setExternalDropTarget] = useState<{ idx: number; before: boolean } | null>(null);
  const externalDropTargetRef = useRef<{ idx: number; before: boolean } | null>(null);

  const { isDragging: isPsyDragging, startDrag, payload: psyPayload } = useDragDrop();
  const isQueueDrag = isPsyDragging && !!psyPayload && (() => {
    try { return QUEUE_DROP_TYPES.has(JSON.parse(psyPayload.data).type); } catch { return false; }
  })();

  useEffect(() => {
    const hitTest = (cx: number, cy: number) => {
      const el = asideRef.current;
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
    };
    return registerQueueDragHitTest(hitTest);
  }, [asideRef]);

  useEffect(() => {
    if (!isPsyDragging) {
      externalDropTargetRef.current = null;
      // React Compiler set-state-in-effect rule: state set from a DOM/layout measurement.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExternalDropTarget(null);
    }
  }, [isPsyDragging]);

  useEffect(() => {
    const aside = asideRef.current;
    if (!aside) return;

    const onPsyDrop = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.data) return;

      let parsedData: {
        type?: string;
        index?: number;
        indices?: number[];
        track?: Track;
        tracks?: Track[];
        serverId?: string;
        id?: string;
      };
      try { parsedData = JSON.parse(detail.data); } catch { return; }

      // Radio streams are not tracks — reject silently
      if (parsedData.type === 'radio') return;

      const dropTarget = externalDropTargetRef.current;
      externalDropTargetRef.current = null;
      setExternalDropTarget(null);

      const insertIdx = dropTarget
        ? (dropTarget.before ? dropTarget.idx : dropTarget.idx + 1)
        : usePlayerStore.getState().queueItems.length;

      if (parsedData.type === 'queue_reorder') {
        psyDragFromIdxRef.current = null;
        moveQueueItems(queueReorderIndices(parsedData), insertIdx);
      } else if (parsedData.type === 'song') {
        enqueueAt([parsedData.track as Track], insertIdx);
      } else if (parsedData.type === 'songs') {
        enqueueAt(parsedData.tracks as Track[], insertIdx);
      } else if (parsedData.type === 'album') {
        const serverId = resolveMediaServerId(parsedData.serverId);
        if (!serverId) return;
        const albumData = await resolveAlbum(serverId, parsedData.id as string);
        if (!albumData) return;
        enqueueAt(
          albumData.songs.map(song => ({ ...songToTrack(song), serverId })),
          insertIdx,
        );
      }
    };

    aside.addEventListener('psy-drop', onPsyDrop);
    return () => aside.removeEventListener('psy-drop', onPsyDrop);
  }, [asideRef, enqueueAt, moveQueueItems]);

  // Drag a queue row outside the panel → remove (drop never reaches `aside`).
  useEffect(() => {
    const onDocPsyDrop = (e: Event) => {
      if (!isQueueVisible) return;
      const d = (e as CustomEvent<{ data?: string; clientX?: number; clientY?: number }>).detail;
      if (!d?.data) return;
      const cx = d.clientX;
      const cy = d.clientY;
      if (typeof cx !== 'number' || typeof cy !== 'number') return;
      let parsed: { type?: string; index?: number; indices?: number[] } | null;
      try {
        parsed = JSON.parse(d.data);
      } catch {
        return;
      }
      if (parsed?.type !== 'queue_reorder') return;
      const indices = queueReorderIndices(parsed);
      if (indices.length === 0) return;
      const aside = asideRef.current;
      if (!aside) return;
      const r = aside.getBoundingClientRect();
      const inside =
        cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
      if (inside) return;
      psyDragFromIdxRef.current = null;
      externalDropTargetRef.current = null;
      setExternalDropTarget(null);
      if (indices.length > 1) {
        const items = usePlayerStore.getState().queueItems;
        removeQueueItems(indices.flatMap(i => (items[i] ? [items[i]] : [])));
      } else {
        removeTrack(indices[0]!);
      }
    };
    document.addEventListener('psy-drop', onDocPsyDrop);
    return () => document.removeEventListener('psy-drop', onDocPsyDrop);
  }, [asideRef, isQueueVisible, removeTrack, removeQueueItems]);

  return {
    psyDragFromIdxRef,
    externalDropTarget,
    externalDropTargetRef,
    setExternalDropTarget,
    isPsyDragging,
    isQueueDrag,
    startDrag,
  };
}
