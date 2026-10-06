import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type HomeSectionId = 'hero' | 'continueListening' | 'recent' | 'discover' | 'becauseYouLike' | 'discoverSongs' | 'discoverArtists' | 'recentlyPlayed' | 'starred' | 'mostPlayed' | 'losslessAlbums';

export interface HomeSectionConfig {
  id: HomeSectionId;
  visible: boolean;
}

export const DEFAULT_HOME_SECTIONS: HomeSectionConfig[] = [
  { id: 'hero',            visible: true },
  { id: 'recent',          visible: true },
  { id: 'becauseYouLike',  visible: true },
  { id: 'continueListening', visible: true },
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
        // A section introduced later lands after its default predecessor, so the
        // settings list shows it where Home renders it.
        const merged = [...safe];
        DEFAULT_HOME_SECTIONS.forEach((section, index) => {
          if (merged.some(s => s.id === section.id)) return;
          const before = DEFAULT_HOME_SECTIONS[index - 1]?.id;
          const beforeAt = before ? merged.findIndex(s => s.id === before) : -1;
          const at = !before ? 0 : beforeAt >= 0 ? beforeAt + 1 : merged.length;
          merged.splice(at, 0, section);
        });
        state.sections = merged;
        if (state.becauseYouLikeSource !== 'similarArtists' && state.becauseYouLikeSource !== 'audiomuse') {
          state.becauseYouLikeSource = DEFAULT_BECAUSE_YOU_LIKE_SOURCE;
        }
      },
    }
  )
);
