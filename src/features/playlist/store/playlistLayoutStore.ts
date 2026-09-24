import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isLayoutCustomized, mergeLayoutItems } from '@/lib/util/layoutItems';
import {
  isPlaylistOwnershipFilter,
  type PlaylistOwnershipFilter,
} from '@/features/playlist/utils/playlistOwnership';
import {
  DEFAULT_PLAYLIST_LIST_SORT,
  isPlaylistListSortKey,
  type PlaylistListSortKey,
} from '@/features/playlist/utils/playlistListSort';

export type PlaylistLayoutItemId =
  | 'shuffle'
  | 'enqueue'
  | 'share'
  | 'editRules'
  | 'refreshSmart'
  | 'addSongs'
  | 'importCsv'
  | 'downloadZip'
  | 'offlineCache'
  | 'suggestions';

export interface PlaylistLayoutItemConfig {
  id: PlaylistLayoutItemId;
  visible: boolean;
}

/**
 * Action-bar buttons after the fixed Play button, in bar order, then the
 * Suggestions section (a toggle only — it is not part of the bar).
 */
export const DEFAULT_PLAYLIST_LAYOUT_ITEMS: PlaylistLayoutItemConfig[] = [
  { id: 'shuffle',      visible: true },
  { id: 'enqueue',      visible: true },
  { id: 'share',        visible: true },
  { id: 'refreshSmart', visible: true },
  { id: 'editRules',    visible: true },
  { id: 'addSongs',     visible: true },
  { id: 'importCsv',    visible: true },
  { id: 'downloadZip',  visible: true },
  { id: 'offlineCache', visible: true },
  { id: 'suggestions',  visible: true },
];

interface PlaylistLayoutStore {
  items: PlaylistLayoutItemConfig[];
  /** Which ownership bucket the Playlists page shows; `all` disables the split. */
  ownershipFilter: PlaylistOwnershipFilter;
  /** Order of the playlist list, shared by the sidebar section and the page. */
  listSortKey: PlaylistListSortKey;
  setItems: (items: PlaylistLayoutItemConfig[]) => void;
  toggleItem: (id: PlaylistLayoutItemId) => void;
  setOwnershipFilter: (filter: PlaylistOwnershipFilter) => void;
  setListSortKey: (key: PlaylistListSortKey) => void;
  reset: () => void;
}

export const usePlaylistLayoutStore = create<PlaylistLayoutStore>()(
  persist(
    (set) => ({
      items: DEFAULT_PLAYLIST_LAYOUT_ITEMS,
      ownershipFilter: 'all',
      listSortKey: DEFAULT_PLAYLIST_LIST_SORT,

      setItems: (items) => set({ items }),

      toggleItem: (id) => set((s) => ({
        items: s.items.map(it => it.id === id ? { ...it, visible: !it.visible } : it),
      })),

      setOwnershipFilter: (ownershipFilter) => set({ ownershipFilter }),

      setListSortKey: (listSortKey) => set({ listSortKey }),

      // Toolbar buttons only. The ownership filter is browse state, not a layout
      // item, so "reset layout" must not silently change which playlists show.
      reset: () => set({ items: DEFAULT_PLAYLIST_LAYOUT_ITEMS }),
    }),
    {
      name: 'psysonic_playlist_layout',
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.items = mergeLayoutItems(state.items, DEFAULT_PLAYLIST_LAYOUT_ITEMS);
        // A value persisted by an older build (or a hand-edited store) must not
        // leave the page stuck on a bucket the control can no longer clear.
        if (!isPlaylistOwnershipFilter(state.ownershipFilter)) state.ownershipFilter = 'all';
        if (!isPlaylistListSortKey(state.listSortKey)) state.listSortKey = DEFAULT_PLAYLIST_LIST_SORT;
      },
    }
  )
);

export function isPlaylistLayoutCustomized(items: PlaylistLayoutItemConfig[]): boolean {
  return isLayoutCustomized(items, DEFAULT_PLAYLIST_LAYOUT_ITEMS);
}
