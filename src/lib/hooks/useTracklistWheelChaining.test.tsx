import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { APP_MAIN_SCROLL_VIEWPORT_ID } from '@/constants/appScroll';
import { useTracklistWheelChaining } from './useTracklistWheelChaining';

const platform = vi.hoisted(() => ({
  IS_LINUX: false,
  IS_MACOS: true,
  IS_WINDOWS: false,
}));

vi.mock('@/lib/util/platform', () => platform);

describe('useTracklistWheelChaining', () => {
  let viewport: HTMLDivElement;
  let tracklist: HTMLDivElement;
  let childRow: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    platform.IS_MACOS = true;
    platform.IS_LINUX = false;
    platform.IS_WINDOWS = false;

    viewport = document.createElement('div');
    viewport.id = APP_MAIN_SCROLL_VIEWPORT_ID;
    viewport.className = 'overlay-scroll__viewport';
    viewport.scrollTop = 100;
    Object.defineProperty(viewport, 'clientHeight', { value: 600, configurable: true });

    tracklist = document.createElement('div');
    tracklist.className = 'tracklist';

    childRow = document.createElement('div');
    childRow.className = 'track-row';

    tracklist.appendChild(childRow);
    viewport.appendChild(tracklist);
    document.body.appendChild(viewport);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (viewport.parentElement) {
      document.body.removeChild(viewport);
    }
  });

  const createWheelEvent = (options: Partial<WheelEventInit> = {}) => {
    return new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: 0,
      deltaY: 0,
      deltaMode: 0,
      ...options,
    });
  };

  it('does NOT intercept ordinary vertical wheel event before any horizontal gesture', () => {
    renderHook(() => useTracklistWheelChaining());

    const verticalEvent = createWheelEvent({ deltaX: 0, deltaY: 50 });
    const preventDefaultSpy = vi.spyOn(verticalEvent, 'preventDefault');

    childRow.dispatchEvent(verticalEvent);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(100);
  });

  it('intercepts vertical recovery event after a horizontal gesture on tracklist', () => {
    renderHook(() => useTracklistWheelChaining());

    // 1. Horizontal swipe arms the recovery listener
    const horizontalEvent = createWheelEvent({ deltaX: 80, deltaY: 0 });
    const horizontalPreventDefaultSpy = vi.spyOn(horizontalEvent, 'preventDefault');
    childRow.dispatchEvent(horizontalEvent);

    expect(horizontalPreventDefaultSpy).not.toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(100);

    // 2. Subsequent vertical event over tracklist is intercepted and forwarded
    const recoveryEvent = createWheelEvent({ deltaX: 0, deltaY: 50 });
    const recoveryPreventDefaultSpy = vi.spyOn(recoveryEvent, 'preventDefault');
    childRow.dispatchEvent(recoveryEvent);

    expect(recoveryPreventDefaultSpy).toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(150);
  });

  it('preserves ctrlKey and metaKey modified wheel inputs even when armed', () => {
    renderHook(() => useTracklistWheelChaining());

    // Arm via horizontal gesture
    childRow.dispatchEvent(createWheelEvent({ deltaX: 50, deltaY: 0 }));

    // Ctrl+wheel (zoom)
    const ctrlEvent = createWheelEvent({ deltaX: 0, deltaY: 50, ctrlKey: true });
    const ctrlSpy = vi.spyOn(ctrlEvent, 'preventDefault');
    childRow.dispatchEvent(ctrlEvent);

    expect(ctrlSpy).not.toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(100);

    // Meta+wheel (zoom / navigation)
    const metaEvent = createWheelEvent({ deltaX: 0, deltaY: 50, metaKey: true });
    const metaSpy = vi.spyOn(metaEvent, 'preventDefault');
    childRow.dispatchEvent(metaEvent);

    expect(metaSpy).not.toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(100);

    // Alt+wheel
    const altEvent = createWheelEvent({ deltaX: 0, deltaY: 50, altKey: true });
    const altSpy = vi.spyOn(altEvent, 'preventDefault');
    childRow.dispatchEvent(altEvent);

    expect(altSpy).not.toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(100);
  });

  it('remains completely inactive when not running on WebKit (platform gating)', () => {
    platform.IS_MACOS = false;
    platform.IS_LINUX = false;
    platform.IS_WINDOWS = true;

    renderHook(() => useTracklistWheelChaining());

    // Attempt to arm via horizontal gesture
    childRow.dispatchEvent(createWheelEvent({ deltaX: 100, deltaY: 0 }));

    // Subsequent vertical gesture
    const event = createWheelEvent({ deltaX: 0, deltaY: 50 });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    childRow.dispatchEvent(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(100);
  });

  it('handles line deltaMode (deltaMode === 1)', () => {
    renderHook(() => useTracklistWheelChaining());

    // Arm
    childRow.dispatchEvent(createWheelEvent({ deltaX: 60, deltaY: 0 }));

    // Line mode: deltaY = 3 lines -> 3 * 20 = 60px
    const lineEvent = createWheelEvent({ deltaX: 0, deltaY: 3, deltaMode: 1 });
    const preventDefaultSpy = vi.spyOn(lineEvent, 'preventDefault');
    childRow.dispatchEvent(lineEvent);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(160);
  });

  it('handles page deltaMode (deltaMode === 2)', () => {
    renderHook(() => useTracklistWheelChaining());

    // Arm
    childRow.dispatchEvent(createWheelEvent({ deltaX: 60, deltaY: 0 }));

    // Page mode: deltaY = 2 pages -> 2 * 600px (viewport.clientHeight) = 1200px
    const pageEvent = createWheelEvent({ deltaX: 0, deltaY: 2, deltaMode: 2 });
    const preventDefaultSpy = vi.spyOn(pageEvent, 'preventDefault');
    childRow.dispatchEvent(pageEvent);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(1300);
  });

  it('activates MutationObserver only when armed and disconnects it when disarmed', () => {
    const observeSpy = vi.spyOn(MutationObserver.prototype, 'observe');
    const disconnectSpy = vi.spyOn(MutationObserver.prototype, 'disconnect');

    const { unmount } = renderHook(() => useTracklistWheelChaining());

    // Initially, MutationObserver must NOT be observing document.body
    expect(observeSpy).not.toHaveBeenCalled();

    // Horizontal gesture arms recovery and activates MutationObserver
    childRow.dispatchEvent(createWheelEvent({ deltaX: 50, deltaY: 0 }));
    expect(observeSpy).toHaveBeenCalledTimes(1);
    expect(observeSpy).toHaveBeenCalledWith(document.body, { childList: true, subtree: true });

    // When disarmed upon hook unmount, observer is disconnected
    unmount();
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it('disarms automatically when the active tracklist is unmounted from the DOM', async () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    renderHook(() => useTracklistWheelChaining());

    // 1. Arm via horizontal gesture on tracklist
    childRow.dispatchEvent(createWheelEvent({ deltaX: 50, deltaY: 0 }));

    // 2. Unmount tracklist from DOM (view / page change)
    viewport.removeChild(tracklist);

    // Allow MutationObserver microtask to execute
    await Promise.resolve();

    // Verify observer actually removed the armed wheel listener
    expect(removeEventListenerSpy).toHaveBeenCalledWith('wheel', expect.any(Function));

    // 3. Mount a new tracklist into the DOM
    const newTracklist = document.createElement('div');
    newTracklist.className = 'tracklist';
    const newChildRow = document.createElement('div');
    newChildRow.className = 'track-row';
    newTracklist.appendChild(newChildRow);
    viewport.appendChild(newTracklist);

    // 4. Verify vertical wheel on new tracklist is NOT intercepted (requires new horizontal gesture)
    const initialVerticalEvent = createWheelEvent({ deltaX: 0, deltaY: 50 });
    const initialPreventDefaultSpy = vi.spyOn(initialVerticalEvent, 'preventDefault');
    newChildRow.dispatchEvent(initialVerticalEvent);

    expect(initialPreventDefaultSpy).not.toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(100);

    // 5. Verify that a new horizontal gesture on the new tracklist arms recovery
    const newHorizontalEvent = createWheelEvent({ deltaX: 60, deltaY: 0 });
    newChildRow.dispatchEvent(newHorizontalEvent);

    // 6. Subsequent vertical wheel on the new tracklist is now intercepted and scrolled
    const recoveryVerticalEvent = createWheelEvent({ deltaX: 0, deltaY: 50 });
    const recoveryPreventDefaultSpy = vi.spyOn(recoveryVerticalEvent, 'preventDefault');
    newChildRow.dispatchEvent(recoveryVerticalEvent);

    expect(recoveryPreventDefaultSpy).toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(150);
  });

  it('does NOT intercept vertical wheel events outside the tracklist', () => {
    renderHook(() => useTracklistWheelChaining());

    // Arm via horizontal gesture on tracklist
    childRow.dispatchEvent(createWheelEvent({ deltaX: 50, deltaY: 0 }));

    const outside = document.createElement('div');
    document.body.appendChild(outside);

    // Vertical scroll outside tracklist is not intercepted
    const outsideEvent = createWheelEvent({ deltaX: 0, deltaY: 50 });
    const outsidePreventDefaultSpy = vi.spyOn(outsideEvent, 'preventDefault');
    outside.dispatchEvent(outsideEvent);

    expect(outsidePreventDefaultSpy).not.toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(100);

    document.body.removeChild(outside);
  });
});

