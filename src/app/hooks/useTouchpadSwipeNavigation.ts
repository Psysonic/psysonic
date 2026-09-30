import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { createSwipeTracker } from '@/lib/navigation/touchpadSwipe';
import { useThemeStore } from '@/store/themeStore';

/**
 * Two-finger horizontal touchpad swipe goes back / forward in the app's
 * history (Settings → Input → Touchpad). Gesture grouping and the
 * "does this belong to a scroller?" checks live in `createSwipeTracker`.
 */
export function useTouchpadSwipeNavigation(): void {
  const enabled = useThemeStore(s => s.touchpadSwipeNavigation);
  const navigate = useNavigate();
  // `navigate` changes identity on every route change. The listener reads it
  // through a ref so the tracker survives the navigation it triggers; a fresh
  // tracker would count the rest of the same swipe as a new one and navigate
  // twice.
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  useEffect(() => {
    if (!enabled) return;
    const tracker = createSwipeTracker();
    const onWheel = (e: WheelEvent) => {
      const direction = tracker.onWheel(e);
      // Plain history steps, like a mouse's back / forward buttons: detail
      // pages keep their own back trap entry (`useAlbumDetailBack`), and at
      // either end of the history the webview simply stays put.
      if (direction === 'back') {
        void navigateRef.current(-1);
      } else if (direction === 'forward') {
        void navigateRef.current(1);
      }
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => window.removeEventListener('wheel', onWheel);
  }, [enabled]);
}
