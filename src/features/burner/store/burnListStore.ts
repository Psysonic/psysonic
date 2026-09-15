import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { applyListReorderById, type ListReorderDropTarget } from '@/lib/util/listReorder';
import type { BurnQueueTrack } from '@/features/burner/utils/capacity';
import { MAX_TRACKS } from '@/features/burner/utils/capacity';

/**
 * The running order for the next disc.
 *
 * Persisted: building a compilation is something people do across sessions,
 * and losing it on restart would be worse than the few KB it costs. Only the
 * queue is kept — resolved local paths are re-checked on every visit, because
 * a track can be evicted from the offline cache between sessions.
 */
export interface BurnListState {
  tracks: BurnQueueTrack[];
  /** Disc-level title, offered as a name for the compilation. */
  discTitle: string;

  add: (tracks: BurnQueueTrack[]) => number;
  remove: (key: string) => void;
  move: (fromIndex: number, toIndex: number) => void;
  /** Drag-to-reorder: move `draggedKey` next to the row the cursor left it on. */
  reorder: (draggedKey: string, target: ListReorderDropTarget) => void;
  setLocalPaths: (paths: Record<string, string | null>) => void;
  setDiscTitle: (title: string) => void;
  clear: () => void;
}

export const useBurnListStore = create<BurnListState>()(
  persist(
    (set, get) => ({
      tracks: [],
      discTitle: '',

      /**
       * Append tracks, skipping ones already queued. Returns how many were
       * actually added so the caller can word its toast honestly.
       */
      add: (incoming) => {
        const existing = new Set(get().tracks.map(t => t.key));
        const fresh = incoming.filter(t => !existing.has(t.key));
        if (fresh.length === 0) return 0;
        const room = Math.max(0, MAX_TRACKS - get().tracks.length);
        const accepted = fresh.slice(0, room);
        if (accepted.length > 0) {
          set(state => ({ tracks: [...state.tracks, ...accepted] }));
        }
        return accepted.length;
      },

      remove: (key) => set(state => ({ tracks: state.tracks.filter(t => t.key !== key) })),

      move: (fromIndex, toIndex) => set(state => {
        const { tracks } = state;
        if (
          fromIndex === toIndex ||
          fromIndex < 0 || fromIndex >= tracks.length ||
          toIndex < 0 || toIndex >= tracks.length
        ) {
          return state;
        }
        const next = [...tracks];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return { tracks: next };
      }),

      // Resolved by stable key, never by index: the ring, the list and the
      // drag all read the same array, and an index-based move desyncs the
      // moment any of them filters. `applyListReorderById` is the shared
      // implementation every reorderable list in the app uses.
      reorder: (draggedKey, target) => set(state => {
        const order = state.tracks.map(track => ({ id: track.key }));
        const next = applyListReorderById(order, draggedKey, target);
        if (!next) return state;
        const byKey = new Map(state.tracks.map(track => [track.key, track]));
        const reordered = next
          .map(entry => byKey.get(entry.id))
          .filter((track): track is NonNullable<typeof track> => track != null);
        return reordered.length === state.tracks.length ? { tracks: reordered } : state;
      }),

      setLocalPaths: (paths) => set(state => ({
        tracks: state.tracks.map(track =>
          track.key in paths ? { ...track, localPath: paths[track.key] } : track,
        ),
      })),

      setDiscTitle: (discTitle) => set({ discTitle }),

      clear: () => set({ tracks: [], discTitle: '' }),
    }),
    {
      name: 'psysonic_burn_list',
      // Resolved paths are deliberately dropped: the offline cache may have
      // evicted a file since last time, so they are re-resolved on mount.
      partialize: (state) => ({
        tracks: state.tracks.map(({ localPath: _localPath, ...rest }) => rest),
        discTitle: state.discTitle,
      }),
    },
  ),
);
