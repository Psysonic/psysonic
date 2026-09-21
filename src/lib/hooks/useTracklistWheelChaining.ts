import { useEffect } from 'react';
import { APP_MAIN_SCROLL_VIEWPORT_ID } from '@/constants/appScroll';

/**
 * Workaround for WebKit scroll-latching deadlock:
 * When a user scrolls horizontally inside `.tracklist`, WebKit latches to it.
 * Subsequent vertical mouse wheel events lack touch phases and are swallowed.
 * This captures vertical wheel events over `.tracklist` and scrolls the viewport.
 */
export function useTracklistWheelChaining(): void {
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (!(e.target as HTMLElement | null)?.closest('.tracklist')) return;

      const viewport = document.getElementById(APP_MAIN_SCROLL_VIEWPORT_ID);
      if (!viewport) return;

      e.preventDefault();
      viewport.scrollTop += e.deltaY * (e.deltaMode === 1 ? 20 : 1);
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);
}
