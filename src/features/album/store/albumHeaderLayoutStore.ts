import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { mergeLayoutItems } from '@/lib/util/layoutItems';

/** Buttons of the album detail action bar after the fixed Play button. */
export type AlbumHeaderButtonId =
  | 'shuffle'
  | 'enqueue'
  | 'favorite'
  | 'share'
  | 'bio'
  | 'download'
  | 'offline';

export interface AlbumHeaderButtonConfig {
  id: AlbumHeaderButtonId;
  visible: boolean;
}

export const DEFAULT_ALBUM_HEADER_BUTTONS: AlbumHeaderButtonConfig[] = [
  { id: 'shuffle',  visible: true },
  { id: 'enqueue',  visible: true },
  { id: 'favorite', visible: true },
  { id: 'share',    visible: true },
  { id: 'bio',      visible: true },
  { id: 'download', visible: true },
  { id: 'offline',  visible: true },
];

interface AlbumHeaderLayoutStore {
  buttons: AlbumHeaderButtonConfig[];
  setButtons: (buttons: AlbumHeaderButtonConfig[]) => void;
  toggleButton: (id: AlbumHeaderButtonId) => void;
  reset: () => void;
}

export const useAlbumHeaderLayoutStore = create<AlbumHeaderLayoutStore>()(
  persist(
    (set) => ({
      buttons: DEFAULT_ALBUM_HEADER_BUTTONS,

      setButtons: (buttons) => set({ buttons }),

      toggleButton: (id) => set((s) => ({
        buttons: s.buttons.map(btn => btn.id === id ? { ...btn, visible: !btn.visible } : btn),
      })),

      reset: () => set({ buttons: DEFAULT_ALBUM_HEADER_BUTTONS }),
    }),
    {
      name: 'psysonic_album_header_layout',
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.buttons = mergeLayoutItems(state.buttons, DEFAULT_ALBUM_HEADER_BUTTONS);
      },
    }
  )
);
