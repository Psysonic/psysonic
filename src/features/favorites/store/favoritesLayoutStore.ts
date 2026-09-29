import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type FavoritesSectionId = 'artists' | 'albums' | 'stations' | 'topArtists' | 'songs';

export interface FavoritesSectionConfig {
  id: FavoritesSectionId;
  visible: boolean;
}

/**
 * Default order matches the historical layout of the Favorites page so
 * existing users see no change until they explicitly customise it.
 */
export const DEFAULT_FAVORITES_SECTIONS: FavoritesSectionConfig[] = [
  { id: 'artists',    visible: true },
  { id: 'albums',     visible: true },
  { id: 'stations',   visible: true },
  { id: 'topArtists', visible: true },
  { id: 'songs',      visible: true },
];

interface FavoritesLayoutStore {
  sections: FavoritesSectionConfig[];
  setSections: (sections: FavoritesSectionConfig[]) => void;
  toggleSection: (id: FavoritesSectionId) => void;
  reset: () => void;
}

export const useFavoritesLayoutStore = create<FavoritesLayoutStore>()(
  persist(
    (set) => ({
      sections: DEFAULT_FAVORITES_SECTIONS,

      setSections: (sections) => set({ sections }),

      toggleSection: (id) => set((s) => ({
        sections: s.sections.map(sec => sec.id === id ? { ...sec, visible: !sec.visible } : sec),
      })),

      reset: () => set({ sections: DEFAULT_FAVORITES_SECTIONS }),
    }),
    {
      name: 'psysonic_favorites_layout',
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Sanitize: drop null/corrupt entries, append any new sections that
        // were added in a later release so they don't silently disappear.
        const knownIds = new Set(DEFAULT_FAVORITES_SECTIONS.map(s => s.id));
        const seen = new Set<FavoritesSectionId>();
        const safe = (state.sections ?? []).filter((s): s is FavoritesSectionConfig => {
          if (s == null || typeof s.id !== 'string' || !knownIds.has(s.id as FavoritesSectionId)) return false;
          if (seen.has(s.id)) return false;
          seen.add(s.id);
          return true;
        });
        const missing = DEFAULT_FAVORITES_SECTIONS.filter(s => !seen.has(s.id));
        state.sections = missing.length > 0 ? [...safe, ...missing] : safe;
      },
    }
  )
);
