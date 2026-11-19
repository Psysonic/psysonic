import { getMusicNetworkRuntimeOrNull } from '@/music-network';
import { firstArtistName, structuredArtistNames } from '@/lib/api/openArtistRefs';
import type { PlayerState } from '@/features/playback/store/playerStoreTypes';

type SetState = (
  partial: Partial<PlayerState> | ((state: PlayerState) => Partial<PlayerState>),
) => void;
type GetState = () => PlayerState;

/**
 * Loved-track actions routed through the Music Network runtime (enrichment
 * primary). `networkLovedCache` is keyed by `${title}::${artist}` (not track id)
 * so other queue rows showing the same song update too. `syncNetworkLovedTracks`
 * merges the primary's loved list with the local cache — local likes win.
 *
 * The love write itself is best-effort on the runtime; the cache update is
 * optimistic so the UI reflects the toggle immediately.
 */
export function createNetworkLoveActions(set: SetState, get: GetState): Pick<
  PlayerState,
  'toggleNetworkLove' | 'setNetworkLoved' | 'setNetworkLovedForSong' | 'syncNetworkLovedTracks'
> {
  return {
    toggleNetworkLove: () => {
      const { currentTrack, networkLoved } = get();
      const runtime = getMusicNetworkRuntimeOrNull();
      if (!currentTrack || !runtime?.getEnrichmentPrimaryId()) return;
      const newLoved = !networkLoved;
      const artists = structuredArtistNames(currentTrack.artists);
      const cacheKey = `${currentTrack.title}::${firstArtistName(currentTrack.artist, artists)}`;
      set(s => ({ networkLoved: newLoved, networkLovedCache: { ...s.networkLovedCache, [cacheKey]: newLoved } }));
      void runtime.setTrackLoved({
        title: currentTrack.title,
        artist: currentTrack.artist,
        ...(artists ? { artists } : {}),
      }, newLoved);
    },

    setNetworkLoved: (v) => {
      const { currentTrack } = get();
      if (currentTrack) {
        const cacheKey = `${currentTrack.title}::${firstArtistName(currentTrack.artist, currentTrack.artists)}`;
        set(s => ({ networkLoved: v, networkLovedCache: { ...s.networkLovedCache, [cacheKey]: v } }));
      } else {
        set({ networkLoved: v });
      }
    },

    syncNetworkLovedTracks: async () => {
      const runtime = getMusicNetworkRuntimeOrNull();
      if (!runtime?.getEnrichmentPrimaryId()) return;
      const newCache = await runtime.syncLovedTracks();
      // Merge with existing cache (local likes take precedence).
      set(s => ({ networkLovedCache: { ...newCache, ...s.networkLovedCache } }));
      const { currentTrack } = get();
      if (currentTrack) {
        const loved = newCache[`${currentTrack.title}::${firstArtistName(currentTrack.artist, currentTrack.artists)}`] ?? false;
        set({ networkLoved: loved });
      }
    },

    setNetworkLovedForSong: (title, artist, v, artists) => {
      const normalizedArtist = firstArtistName(artist, artists);
      const cacheKey = `${title}::${normalizedArtist}`;
      const cur = get().currentTrack;
      const isCurrentTrack = cur?.title === title && firstArtistName(cur.artist, cur.artists) === normalizedArtist;
      set(s => ({
        networkLovedCache: { ...s.networkLovedCache, [cacheKey]: v },
        ...(isCurrentTrack ? { networkLoved: v } : {}),
      }));
    },
  };
}
