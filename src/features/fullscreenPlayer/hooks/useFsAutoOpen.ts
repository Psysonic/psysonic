import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { usePlayerStore, usePreviewStore } from '@/features/playback';
import { useWindowVisibility } from '@/lib/hooks/useWindowVisibility';
import { useAuthStore } from '@/store/authStore';

/** While the window is minimized there is nothing to show the player on; look again later. */
const MINIMIZED_RECHECK_MS = 30_000;
/** A layout change under a resting cursor fires mousemove at the same spot, so only travel wakes. */
const WAKE_MOVE_PX = 4;
/** The click that ends a waking press must not land on whatever sits under the player. */
const SWALLOW_FOLLOW_UP_MS = 1000;
const FOLLOW_UP_EVENTS = ['click', 'auxclick', 'dblclick', 'contextmenu'] as const;

async function isWindowMinimized(): Promise<boolean> {
  try {
    return await getCurrentWindow().isMinimized();
  } catch {
    return false;
  }
}

function stopEvent(e: Event): void {
  e.preventDefault();
  e.stopImmediatePropagation();
}

function swallowFollowUpClicks(): void {
  for (const type of FOLLOW_UP_EVENTS) window.addEventListener(type, stopEvent, true);
  setTimeout(() => {
    for (const type of FOLLOW_UP_EVENTS) window.removeEventListener(type, stopEvent, true);
  }, SWALLOW_FOLLOW_UP_MS);
}

/**
 * Opens the fullscreen player once the configured minutes pass without input
 * while a track plays and the window is on screen. A player opened this way acts
 * like a screensaver: the next input closes it and is consumed, so a waking key
 * or click never reaches the controls underneath. A player opened by hand is
 * left alone.
 */
export function useFsAutoOpen(): void {
  const minutes = useAuthStore(s => s.fullscreenAutoOpenMinutes);
  const isFullscreenOpen = usePlayerStore(s => s.isFullscreenOpen);
  const isPlayingTrack = usePlayerStore(s => s.isPlaying && !!s.currentTrack && !s.currentRadio);
  const isPreviewing = usePreviewStore(s => s.previewingId !== null);
  const windowHidden = useWindowVisibility();
  const lastInputAtRef = useRef(0);
  const autoOpenedRef = useRef(false);
  const wakeAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const enabled = minutes > 0;

  useEffect(() => {
    if (!isFullscreenOpen) autoOpenedRef.current = false;
  }, [isFullscreenOpen]);

  // Bringing the window back is the user returning, even without input inside it.
  useEffect(() => {
    if (!windowHidden) lastInputAtRef.current = Date.now();
  }, [windowHidden]);

  // Registered as soon as the setting is on, so long before the player mounts and
  // ahead of its own capture listeners — a waking Escape must not also reach the
  // player's Escape handler, which would toggle it straight back open.
  useEffect(() => {
    if (!enabled) return;
    const markInput = () => { lastInputAtRef.current = Date.now(); };
    markInput();
    const awaitingWake = () => autoOpenedRef.current && usePlayerStore.getState().isFullscreenOpen;
    const wake = () => {
      autoOpenedRef.current = false;
      markInput();
      const player = usePlayerStore.getState();
      if (player.isFullscreenOpen) player.toggleFullscreen();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (awaitingWake()) {
        const anchor = wakeAnchorRef.current;
        if (!anchor) {
          wakeAnchorRef.current = { x: e.screenX, y: e.screenY };
          return;
        }
        if (Math.abs(e.screenX - anchor.x) + Math.abs(e.screenY - anchor.y) < WAKE_MOVE_PX) return;
        wake();
        return;
      }
      markInput();
    };
    const onWheel = () => {
      if (awaitingWake()) wake();
      else markInput();
    };
    const onPress = (e: Event) => {
      if (!awaitingWake()) {
        markInput();
        return;
      }
      stopEvent(e);
      if (e.type === 'pointerdown') swallowFollowUpClicks();
      wake();
    };

    window.addEventListener('mousemove', onMouseMove, { capture: true, passive: true });
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    window.addEventListener('pointerdown', onPress, true);
    window.addEventListener('keydown', onPress, true);
    window.addEventListener('focus', markInput);
    return () => {
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('pointerdown', onPress, true);
      window.removeEventListener('keydown', onPress, true);
      window.removeEventListener('focus', markInput);
    };
  }, [enabled]);

  // The countdown reads the input clock instead of restarting on every state
  // change: playback flips `isPlaying` off and on between tracks, and a
  // restart there would keep the player from ever opening on short tracks.
  const armed = enabled && isPlayingTrack && !isPreviewing && !isFullscreenOpen && !windowHidden;
  useEffect(() => {
    if (!armed) return;
    const delayMs = minutes * 60_000;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      const remaining = lastInputAtRef.current + delayMs - Date.now();
      if (remaining > 0) {
        timer = setTimeout(() => { void check(); }, remaining);
        return;
      }
      const minimized = await isWindowMinimized();
      if (cancelled) return;
      if (minimized) {
        timer = setTimeout(() => { void check(); }, MINIMIZED_RECHECK_MS);
        return;
      }
      const player = usePlayerStore.getState();
      if (player.isFullscreenOpen) return;
      autoOpenedRef.current = true;
      wakeAnchorRef.current = null;
      player.toggleFullscreen();
    };

    void check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [armed, minutes]);
}
