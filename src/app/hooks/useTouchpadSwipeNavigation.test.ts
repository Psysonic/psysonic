import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useThemeStore } from '@/store/themeStore';
import { useTouchpadSwipeNavigation } from './useTouchpadSwipeNavigation';

const navigate = vi.fn();
vi.mock('react-router', async importOriginal => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => navigate,
}));

function swipe(deltaX: number) {
  for (let i = 0; i < 10; i++) {
    window.dispatchEvent(new WheelEvent('wheel', { deltaX, bubbles: true }));
  }
}

describe('useTouchpadSwipeNavigation', () => {
  beforeEach(() => {
    navigate.mockReset();
    useThemeStore.setState({ touchpadSwipeNavigation: true });
  });

  afterEach(() => {
    useThemeStore.setState({ touchpadSwipeNavigation: true });
  });

  it('goes back from an album page whose back-trap entry has no router index', () => {
    // `useAlbumDetailBack` pushes this entry; it carries no React Router `idx`.
    window.history.pushState({ psysonicDetailBackTrap: true }, '', window.location.href);
    renderHook(() => useTouchpadSwipeNavigation());

    swipe(-20);

    expect(navigate).toHaveBeenCalledExactlyOnceWith(-1);
  });

  it('goes forward on a swipe the other way', () => {
    renderHook(() => useTouchpadSwipeNavigation());

    swipe(20);

    expect(navigate).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('does nothing when turned off in Settings', () => {
    useThemeStore.setState({ touchpadSwipeNavigation: false });
    renderHook(() => useTouchpadSwipeNavigation());

    swipe(-20);

    expect(navigate).not.toHaveBeenCalled();
  });
});
