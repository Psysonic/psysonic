import { useEffect } from 'react';
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

  useEffect(() => {
    if (!enabled) return;
    const tracker = createSwipeTracker();
    const onWheel = (e: WheelEvent) => {
      const direction = tracker.onWheel(e);
      // Plain history steps, like a mouse's back / forward buttons: detail
      // pages keep their own back trap entry (`useAlbumDetailBack`), and at
      // either end of the history the webview simply stays put.
      if (direction === 'back') {
        void navigate(-1);
      } else if (direction === 'forward') {
        void navigate(1);
      }
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => window.removeEventListener('wheel', onWheel);
  }, [enabled, navigate]);
}
