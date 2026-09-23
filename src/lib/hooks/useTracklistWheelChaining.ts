import { useEffect } from 'react';
import { APP_MAIN_SCROLL_VIEWPORT_ID } from '@/constants/appScroll';
import { IS_LINUX, IS_MACOS } from '@/lib/util/platform';

function isInsideTracklist(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target instanceof Element ? target : (target as Node).parentElement;
  return Boolean(el?.closest('.tracklist'));
}

/**
 * Workaround for WebKit scroll-latching deadlock:
 * When a user scrolls horizontally inside `.tracklist`, WebKit's ScrollingTree
 * latches to it. Subsequent vertical mouse wheel events lack touch phases
 * (NSEventPhaseNone) and are swallowed by WebKit instead of chaining upwards.
 *
 * To avoid forcing all scroll events onto the main thread and intercepting
 * ordinary vertical or modified wheel input, this hook:
 * 1. Gates execution strictly to WebKit (macOS / Linux).
 * 2. Uses a passive listener to detect horizontal gestures on `.tracklist`.
 * 3. Only arms a cancelable (non-passive) recovery listener when latched.
 * 4. Disarms automatically as soon as the tracklist unmounts (view/page change).
 * 5. Preserves modified events (e.g. Ctrl/Meta/Alt zoom gestures).
 * 6. Handles line (deltaMode = 1) and page (deltaMode = 2) scroll modes.
 */
export function useTracklistWheelChaining(): void {
  useEffect(() => {
    if (!IS_MACOS && !IS_LINUX) {
      return;
    }

    let isArmed = false;
    let activeTracklist: Element | null = null;

    const disarm = () => {
      if (isArmed) {
        isArmed = false;
        activeTracklist = null;
        window.removeEventListener('wheel', onArmedWheel);
      }
    };

    const arm = (tracklist: Element) => {
      activeTracklist = tracklist;
      if (!isArmed) {
        isArmed = true;
        window.addEventListener('wheel', onArmedWheel, { passive: false });
      }
    };

    // Automatically disarm when the latched tracklist unmounts (route or view change)
    const observer = new MutationObserver(() => {
      if (activeTracklist && !activeTracklist.isConnected) {
        disarm();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const onPassiveWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;

      const target = e.target instanceof Element ? e.target : (e.target as Node | null)?.parentElement;
      const tracklist = target?.closest('.tracklist');
      if (tracklist) {
        arm(tracklist);
      }
    };

    const onArmedWheel = (e: WheelEvent) => {
      if (activeTracklist && !activeTracklist.isConnected) {
        disarm();
        return;
      }

      // Preserve modified wheel input (e.g. zoom / browser shortcuts)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Allow native horizontal gestures to proceed
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;

      // Only recover vertical wheel events targeting the tracklist
      if (!isInsideTracklist(e.target)) return;

      const viewport = document.getElementById(APP_MAIN_SCROLL_VIEWPORT_ID);
      if (!viewport) return;

      e.preventDefault();

      let scrollDelta = e.deltaY;
      if (e.deltaMode === 1) {
        scrollDelta *= 20;
      } else if (e.deltaMode === 2) {
        scrollDelta *= viewport.clientHeight || window.innerHeight;
      }

      viewport.scrollTop += scrollDelta;
    };

    window.addEventListener('wheel', onPassiveWheel, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener('wheel', onPassiveWheel);
      disarm();
    };
  }, []);
}



