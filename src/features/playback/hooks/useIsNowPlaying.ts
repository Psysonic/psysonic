import { usePlayerStore } from '@/features/playback/store/playerStore';
import { nowPlayingMatches, type NowPlayingKind } from '@/features/playback/utils/playback/nowPlayingMatch';

/**
 * True while the card for `kind`/`id` belongs to what is playing. The selector
 * returns a boolean, so a card re-renders only when its own answer flips — on
 * a track change, not on every progress tick.
 */
export function useIsNowPlaying(kind: NowPlayingKind, id: string, serverId?: string): boolean {
  return usePlayerStore(s => nowPlayingMatches(s, kind, id, serverId));
}
