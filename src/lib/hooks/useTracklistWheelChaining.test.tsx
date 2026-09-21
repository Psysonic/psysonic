import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTracklistWheelChaining } from './useTracklistWheelChaining';
import { APP_MAIN_SCROLL_VIEWPORT_ID } from '@/constants/appScroll';

describe('useTracklistWheelChaining', () => {
  let viewport: HTMLDivElement;
  let tracklist: HTMLDivElement;
  let childRow: HTMLDivElement;

  beforeEach(() => {
    viewport = document.createElement('div');
    viewport.id = APP_MAIN_SCROLL_VIEWPORT_ID;
    viewport.className = 'overlay-scroll__viewport';
    viewport.scrollTop = 100;

    tracklist = document.createElement('div');
    tracklist.className = 'tracklist';

    childRow = document.createElement('div');
    childRow.className = 'track-row';

    tracklist.appendChild(childRow);
    viewport.appendChild(tracklist);
    document.body.appendChild(viewport);
  });

  afterEach(() => {
    document.body.removeChild(viewport);
  });

  it('forwards vertical wheel event to viewport and prevents default when target is inside tracklist', () => {
    renderHook(() => useTracklistWheelChaining());

    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: 0,
      deltaY: 50,
      deltaMode: 0,
    });

    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    childRow.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(150);
  });

  it('does NOT intercept horizontal scrolling inside tracklist', () => {
    renderHook(() => useTracklistWheelChaining());

    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: 80,
      deltaY: 10,
      deltaMode: 0,
    });

    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    childRow.dispatchEvent(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(100); // Unchanged
  });

  it('does NOT intercept events outside tracklist or rails', () => {
    renderHook(() => useTracklistWheelChaining());

    const outside = document.createElement('div');
    document.body.appendChild(outside);

    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: 0,
      deltaY: 50,
      deltaMode: 0,
    });

    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    outside.dispatchEvent(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(100); // Unchanged

    document.body.removeChild(outside);
  });
});
