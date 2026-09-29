import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type HomeSectionId = 'hero' | 'recent' | 'discover' | 'becauseYouLike' | 'discoverSongs' | 'discoverArtists' | 'recentlyPlayed' | 'starred' | 'mostPlayed' | 'losslessAlbums';

export interface HomeSectionConfig {
  id: HomeSectionId;
  visible: boolean;
}

export const DEFAULT_HOME_SECTIONS: HomeSectionConfig[] = [
  { id: 'hero',            visible: true },
  { id: 'recent',          visible: true },
  { id: 'becauseYouLike',  visible: true },
  { id: 'discover',        visible: true },
  { id: 'discoverSongs',   visible: true },
  { id: 'discoverArtists', visible: true },
  { id: 'recentlyPlayed',  visible: true },
  { id: 'starred',         visible: true },
  { id: 'mostPlayed',      visible: true },
  { id: 'losslessAlbums',  visible: true },
];

/**
 * Where the "Because you listened" rail finds its albums: albums by artists the
 * server lists as similar (`getArtistInfo2`), or AudioMuse sonic matches. The
 * AudioMuse choice only applies on servers where sonic similarity is active;
 * elsewhere the rail keeps using similar artists.
 */
export type BecauseYouLikeSource = 'similarArtists' | 'audiomuse';

export const DEFAULT_BECAUSE_YOU_LIKE_SOURCE: BecauseYouLikeSource = 'similarArtists';

interface HomeStore {
  sections: HomeSectionConfig[];
  becauseYouLikeSource: BecauseYouLikeSource;
  toggleSection: (id: HomeSectionId) => void;
  setBecauseYouLikeSource: (source: BecauseYouLikeSource) => void;
  reset: () => void;
}

export const useHomeStore = create<HomeStore>()(
  persist(
    (set) => ({
      sections: DEFAULT_HOME_SECTIONS,
      becauseYouLikeSource: DEFAULT_BECAUSE_YOU_LIKE_SOURCE,
      toggleSection: (id) => set((s) => ({
        sections: s.sections.map(sec => sec.id === id ? { ...sec, visible: !sec.visible } : sec),
      })),
      setBecauseYouLikeSource: (source) => set({ becauseYouLikeSource: source }),
      reset: () => set({
        sections: DEFAULT_HOME_SECTIONS,
        becauseYouLikeSource: DEFAULT_BECAUSE_YOU_LIKE_SOURCE,
      }),
    }),
    {
      name: 'psysonic_home',
      onRehydrateStorage: () => (state) => {
        // Append any sections introduced after the user first persisted their order,
        // so new defaults show up without forcing a manual Reset.
        if (!state) return;
        const safe = (state.sections ?? []).filter(
          (s): s is HomeSectionConfig => s != null && typeof s.id === 'string',
        );
        const known = new Set(safe.map(s => s.id));
        const missing = DEFAULT_HOME_SECTIONS.filter(s => !known.has(s.id));
        state.sections = missing.length > 0 ? [...safe, ...missing] : safe;
        if (state.becauseYouLikeSource !== 'similarArtists' && state.becauseYouLikeSource !== 'audiomuse') {
          state.becauseYouLikeSource = DEFAULT_BECAUSE_YOU_LIKE_SOURCE;
        }
      },
    }
  )
);
