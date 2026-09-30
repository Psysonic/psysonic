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
      if (direction === 'back') {
        // React Router's history index; 0 is the first page of this session,
        // where going back would leave the app shell.
        const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
        if (idx > 0) void navigate(-1);
      } else if (direction === 'forward') {
        void navigate(1);
      }
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => window.removeEventListener('wheel', onWheel);
  }, [enabled, navigate]);
}
