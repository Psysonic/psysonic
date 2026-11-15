import type { AuthState } from './authStoreTypes';
import { normalizeLyricsScale } from '@/lib/media/lyricsAppearance';

type SetState = (
  partial: Partial<AuthState> | ((state: AuthState) => Partial<AuthState>),
) => void;

/**
 * Lyrics content settings: source order/enablement, text scale, layer priority
 * and the static-only rendering toggle. Visual lyrics chrome (rail vs apple,
 * fullscreen show/hide) lives in `authUiAppearanceActions.ts`.
 */
export function createLyricsSettingsActions(set: SetState): Pick<
  AuthState,
  | 'setLyricsServerFirst'
  | 'setEnableNeteaselyrics'
  | 'setLyricsSources'
  | 'setLyricsStaticOnly'
  | 'setLyricsRomanizationEnabled'
  | 'setLyricsScale'
  | 'setLyricsSizeIndicatorEnabled'
  | 'setLyricsRomanizationPrimary'
  | 'setLyricsTranslationEnabled'
  | 'setLyricsWordHighlightMode'
> {
  return {
    setLyricsServerFirst: (v) => set({ lyricsServerFirst: v }),
    setEnableNeteaselyrics: (v) => set({ enableNeteaselyrics: v }),
    setLyricsSources: (sources) => set({ lyricsSources: sources }),
    setLyricsStaticOnly: (v) => set({ lyricsStaticOnly: v }),
    setLyricsRomanizationEnabled: (v) => set({ lyricsRomanizationEnabled: v }),
    setLyricsScale: (v) => set({ lyricsScale: normalizeLyricsScale(v) }),
    setLyricsSizeIndicatorEnabled: (v) => set({ lyricsSizeIndicatorEnabled: v === true }),
    setLyricsRomanizationPrimary: (v) => set({ lyricsRomanizationPrimary: v === true }),
    setLyricsTranslationEnabled: (v) => set({ lyricsTranslationEnabled: v }),
    setLyricsWordHighlightMode: (v) => set({ lyricsWordHighlightMode: v }),
  };
}
