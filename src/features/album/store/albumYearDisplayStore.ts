import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Album year shown on cards and headers: the original release, this edition, or both. */
export type AlbumYearDisplay = 'original' | 'release' | 'both';

export const DEFAULT_ALBUM_YEAR_DISPLAY: AlbumYearDisplay = 'original';

function isAlbumYearDisplay(value: unknown): value is AlbumYearDisplay {
  return value === 'original' || value === 'release' || value === 'both';
}

interface AlbumYearDisplayStore {
  display: AlbumYearDisplay;
  setDisplay: (display: AlbumYearDisplay) => void;
}

export const useAlbumYearDisplayStore = create<AlbumYearDisplayStore>()(
  persist(
    set => ({
      display: DEFAULT_ALBUM_YEAR_DISPLAY,
      setDisplay: display => set({ display }),
    }),
    {
      name: 'psysonic_album_year_display',
      // A value a later version no longer knows must not leave cards without a year.
      merge: (persisted, current) => {
        const display = (persisted as Partial<AlbumYearDisplayStore> | undefined)?.display;
        return { ...current, display: isAlbumYearDisplay(display) ? display : current.display };
      },
    },
  ),
);

/** The "Album year" display setting (Settings → Appearance). */
export function useAlbumYearDisplay(): AlbumYearDisplay {
  return useAlbumYearDisplayStore(s => s.display);
}
