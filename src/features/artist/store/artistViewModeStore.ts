import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ArtistBrowseViewMode = 'grid' | 'list';

export const DEFAULT_ARTIST_VIEW_MODE: ArtistBrowseViewMode = 'grid';

function isArtistViewMode(value: unknown): value is ArtistBrowseViewMode {
  return value === 'grid' || value === 'list';
}

interface ArtistViewModeStore {
  viewMode: ArtistBrowseViewMode;
  setViewMode: (viewMode: ArtistBrowseViewMode) => void;
}

export const useArtistViewModeStore = create<ArtistViewModeStore>()(
  persist(
    (set) => ({
      viewMode: DEFAULT_ARTIST_VIEW_MODE,
      setViewMode: (viewMode) => set({ viewMode }),
    }),
    {
      name: 'psysonic_artist_view_mode',
      version: 1,
      merge: (persistedState, currentState) => {
        const viewMode = (persistedState as { viewMode?: unknown } | undefined)?.viewMode;
        return {
          ...currentState,
          viewMode: isArtistViewMode(viewMode) ? viewMode : DEFAULT_ARTIST_VIEW_MODE,
        };
      },
    },
  ),
);
