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

const KNOWN_HOME_SECTION_IDS = new Set<string>(DEFAULT_HOME_SECTIONS.map(s => s.id));

/**
 * A stored or edited section list made whole: unknown and repeated entries
 * dropped, a section introduced later slotted in after its default
 * predecessor (so the settings list shows it where Home renders it), and the
 * hero kept first, since it sits above the rails and does not move.
 */
export function normalizeHomeSections(sections: readonly unknown[] | null | undefined): HomeSectionConfig[] {
  const seen = new Set<string>();
  const merged: HomeSectionConfig[] = [];
  for (const entry of sections ?? []) {
    if (entry == null || typeof entry !== 'object') continue;
    const { id, visible } = entry as Partial<HomeSectionConfig>;
    if (typeof id !== 'string' || !KNOWN_HOME_SECTION_IDS.has(id) || seen.has(id)) continue;
    seen.add(id);
    merged.push({ id, visible: visible !== false });
  }
  DEFAULT_HOME_SECTIONS.forEach((section, index) => {
    if (seen.has(section.id)) return;
    const before = DEFAULT_HOME_SECTIONS[index - 1]?.id;
    const beforeAt = before ? merged.findIndex(s => s.id === before) : -1;
    const at = !before ? 0 : beforeAt >= 0 ? beforeAt + 1 : merged.length;
    merged.splice(at, 0, section);
  });
  const heroAt = merged.findIndex(s => s.id === 'hero');
  if (heroAt > 0) merged.unshift(...merged.splice(heroAt, 1));
  return merged;
}

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
  setSections: (sections: HomeSectionConfig[]) => void;
  toggleSection: (id: HomeSectionId) => void;
  setBecauseYouLikeSource: (source: BecauseYouLikeSource) => void;
  reset: () => void;
}

export const useHomeStore = create<HomeStore>()(
  persist(
    (set) => ({
      sections: DEFAULT_HOME_SECTIONS,
      becauseYouLikeSource: DEFAULT_BECAUSE_YOU_LIKE_SOURCE,
      setSections: (sections) => set({ sections: normalizeHomeSections(sections) }),
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
        if (!state) return;
        state.sections = normalizeHomeSections(state.sections);
        if (state.becauseYouLikeSource !== 'similarArtists' && state.becauseYouLikeSource !== 'audiomuse') {
          state.becauseYouLikeSource = DEFAULT_BECAUSE_YOU_LIKE_SOURCE;
        }
      },
    }
  )
);
