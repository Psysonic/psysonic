import { useCallback, useRef, type CSSProperties } from 'react';
import { useAuthStore } from '@/store/authStore';
import {
  createLyricsZoomWheelHandler,
  lyricsScaleForAction,
  type LyricsZoomAction,
} from '@/lib/media/lyricsAppearance';

export function applyLyricsZoom(action: LyricsZoomAction) {
  const state = useAuthStore.getState();
  const next = lyricsScaleForAction(state.lyricsScale, action);
  if (next !== state.lyricsScale) state.setLyricsScale(next);
}

const resetZoom = () => applyLyricsZoom('reset');

function bindWheel(node: HTMLElement, requireModifier: boolean, pageHeight: () => number) {
  const handler = createLyricsZoomWheelHandler({
    getScale: () => useAuthStore.getState().lyricsScale,
    setScale: scale => useAuthStore.getState().setLyricsScale(scale),
    pageHeight,
    requireModifier,
  });
  node.addEventListener('wheel', handler, { passive: false });
  return () => node.removeEventListener('wheel', handler);
}

/** One subscription per surface, never per line or playback tick. */
export function useLyricsAppearance() {
  const scale = useAuthStore(s => s.lyricsScale);
  const showSizeIndicator = useAuthStore(s => s.lyricsSizeIndicatorEnabled);
  const romanizationPrimary = useAuthStore(s => s.lyricsRomanizationPrimary);
  const detach = useRef<(() => void) | null>(null);
  const detachBadge = useRef<(() => void) | null>(null);
  const viewport = useRef<HTMLDivElement | null>(null);
  // A callback ref handles loading/no-track branches as well as ordinary unmounts.
  const appearanceRef = useCallback((node: HTMLDivElement | null) => {
    detach.current?.();
    detach.current = null;
    viewport.current = node;
    if (!node) return;
    detach.current = bindWheel(node, true, () => node.clientHeight || window.innerHeight);
  }, []);

  const badgeRef = useCallback((node: HTMLButtonElement | null) => {
    detachBadge.current?.();
    detachBadge.current = null;
    if (node) detachBadge.current = bindWheel(node, false, () => viewport.current?.clientHeight || window.innerHeight);
  }, []);

  return {
    scale,
    showSizeIndicator,
    resetZoom,
    badgeRef,
    romanizationPrimary,
    appearanceRef,
    appearanceStyle: { '--lyrics-scale': scale } as CSSProperties,
  };
}
