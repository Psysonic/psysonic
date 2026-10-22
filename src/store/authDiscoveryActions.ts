import { clampMixFilterMinStars, clampRandomMixSize } from './authStoreHelpers';
import type { AuthState } from './authStoreTypes';

type SetState = (
  partial: Partial<AuthState> | ((state: AuthState) => Partial<AuthState>),
) => void;

/**
 * Discovery + auto-queue settings: mix min-rating thresholds (each
 * clamped to 0…3 stars), random-mix size (snapped to the allowed
 * RANDOM_MIX_SIZE_OPTIONS bucket), lucky-mix sidebar visibility,
 * random-nav style, infinite-queue, preserve-play-next-order and
 * smart-shuffle toggles.
 */
export function createDiscoveryActions(set: SetState): Pick<
  AuthState,
  | 'setMixMinRatingFilterEnabled'
  | 'setMixMinRatingSong'
  | 'setMixMinRatingAlbum'
  | 'setMixMinRatingArtist'
  | 'setRandomMixSize'
  | 'setShowLuckyMixMenu'
  | 'setRandomNavMode'
  | 'setNowPlayingAtTop'
  | 'setInfiniteQueueEnabled'
  | 'setPreservePlayNextOrder'
  | 'setSmartShuffleEnabled'
> {
  return {
    setMixMinRatingFilterEnabled: (v) => set({ mixMinRatingFilterEnabled: v }),
    setMixMinRatingSong: (v) => set({ mixMinRatingSong: clampMixFilterMinStars(v) }),
    setMixMinRatingAlbum: (v) => set({ mixMinRatingAlbum: clampMixFilterMinStars(v) }),
    setMixMinRatingArtist: (v) => set({ mixMinRatingArtist: clampMixFilterMinStars(v) }),
    setRandomMixSize: (v) => set({ randomMixSize: clampRandomMixSize(v) }),
    setShowLuckyMixMenu: (v) => set({ showLuckyMixMenu: v }),
    setRandomNavMode: (v) => set({ randomNavMode: v }),
    setNowPlayingAtTop: (v) => set({ nowPlayingAtTop: v }),
    setInfiniteQueueEnabled: (v) => set({ infiniteQueueEnabled: v }),
    setPreservePlayNextOrder: (v) => set({ preservePlayNextOrder: v }),
    setSmartShuffleEnabled: (v) => set({ smartShuffleEnabled: v }),
  };
}
