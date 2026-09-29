import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useDragEdgeScroll,
  edgeScrollSpeed,
  EDGE_SCROLL_ZONE_PX,
  EDGE_SCROLL_MAX_PX_PER_SEC,
} from '@/lib/dnd/useDragEdgeScroll';

const RECT = { top: 100, bottom: 500, left: 200, right: 400 } as DOMRect;

/** jsdom measures nothing and scrolls nothing, so both are supplied here. */
function makeViewport(): HTMLDivElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => RECT;
  Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true });
  document.body.appendChild(el);
  return el;
}

let pendingFrames: FrameRequestCallback[] = [];

/** Runs the frames queued so far at `time`, the way a browser would. */
function runFrame(time: number): void {
  const due = pendingFrames;
  pendingFrames = [];
  for (const cb of due) cb(time);
}

const moveTo = (x: number, y: number) =>
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }));

beforeEach(() => {
  pendingFrames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    pendingFrames.push(cb);
    return pendingFrames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('edgeScrollSpeed', () => {
  it('stands still in the middle of the list', () => {
    expect(edgeScrollSpeed(300, RECT)).toBe(0);
  });

  it('runs at full speed once the pointer has left an edge entirely', () => {
    expect(edgeScrollSpeed(RECT.top - 40, RECT)).toBe(-EDGE_SCROLL_MAX_PX_PER_SEC);
    expect(edgeScrollSpeed(RECT.bottom + 40, RECT)).toBe(EDGE_SCROLL_MAX_PX_PER_SEC);
  });

  it('eases in across the band instead of switching on', () => {
    const justInside = edgeScrollSpeed(RECT.top + EDGE_SCROLL_ZONE_PX - 1, RECT);
    const halfway = edgeScrollSpeed(RECT.top + EDGE_SCROLL_ZONE_PX / 2, RECT);
    const atTheEdge = edgeScrollSpeed(RECT.top, RECT);

    // One pixel inside the band is one 56th of the ramp, not a standing start.
    expect(justInside).toBeGreaterThan(-EDGE_SCROLL_MAX_PX_PER_SEC / 40);
    expect(justInside).toBeLessThan(0);
    expect(halfway).toBeCloseTo(-EDGE_SCROLL_MAX_PX_PER_SEC / 2, 5);
    expect(atTheEdge).toBe(-EDGE_SCROLL_MAX_PX_PER_SEC);
  });

  it('is symmetric at both edges', () => {
    const top = edgeScrollSpeed(RECT.top + 10, RECT);
    const bottom = edgeScrollSpeed(RECT.bottom - 10, RECT);
    expect(bottom).toBeCloseTo(-top, 5);
  });
});

describe('useDragEdgeScroll', () => {
  it('scrolls down while the pointer is held in the bottom band', () => {
    const viewport = makeViewport();
    renderHook(() => useDragEdgeScroll({ current: viewport }, true));

    runFrame(0);
    moveTo(300, RECT.bottom);
    runFrame(1000);

    // One second at full speed.
    expect(viewport.scrollTop).toBeCloseTo(EDGE_SCROLL_MAX_PX_PER_SEC, 5);
  });

  it('scrolls up in the top band', () => {
    const viewport = makeViewport();
    viewport.scrollTop = 1000;
    renderHook(() => useDragEdgeScroll({ current: viewport }, true));

    runFrame(0);
    moveTo(300, RECT.top);
    runFrame(1000);

    expect(viewport.scrollTop).toBeCloseTo(1000 - EDGE_SCROLL_MAX_PX_PER_SEC, 5);
  });

  // The speed is per second, so the same elapsed time has to move the list the
  // same distance whether it arrives in one frame or ten.
  it('covers the same distance regardless of frame rate', () => {
    const slow = makeViewport();
    renderHook(() => useDragEdgeScroll({ current: slow }, true));
    runFrame(0);
    moveTo(300, RECT.bottom);
    runFrame(500);
    const afterOneFrame = slow.scrollTop;

    pendingFrames = [];
    const fast = makeViewport();
    renderHook(() => useDragEdgeScroll({ current: fast }, true));
    runFrame(0);
    moveTo(300, RECT.bottom);
    for (let t = 50; t <= 500; t += 50) runFrame(t);

    expect(fast.scrollTop).toBeCloseTo(afterOneFrame, 5);
  });

  it('stays put while the pointer is in the middle', () => {
    const viewport = makeViewport();
    renderHook(() => useDragEdgeScroll({ current: viewport }, true));

    runFrame(0);
    moveTo(300, 300);
    runFrame(1000);

    expect(viewport.scrollTop).toBe(0);
  });

  // A drag crossing the window somewhere else must not drag the list with it.
  it('ignores a pointer at the right height but beside the list', () => {
    const viewport = makeViewport();
    renderHook(() => useDragEdgeScroll({ current: viewport }, true));

    runFrame(0);
    moveTo(RECT.right + 50, RECT.bottom);
    runFrame(1000);

    expect(viewport.scrollTop).toBe(0);
  });

  it('does nothing at all while disabled', () => {
    const viewport = makeViewport();
    renderHook(() => useDragEdgeScroll({ current: viewport }, false));

    moveTo(300, RECT.bottom);
    runFrame(0);
    runFrame(1000);

    expect(viewport.scrollTop).toBe(0);
  });

  it('stops scrolling when the drag ends', () => {
    const viewport = makeViewport();
    const { rerender } = renderHook(
      ({ enabled }) => useDragEdgeScroll({ current: viewport }, enabled),
      { initialProps: { enabled: true } },
    );

    runFrame(0);
    moveTo(300, RECT.bottom);
    runFrame(1000);
    const whileDragging = viewport.scrollTop;
    expect(whileDragging).toBeGreaterThan(0);

    rerender({ enabled: false });
    runFrame(2000);
    runFrame(3000);

    expect(viewport.scrollTop).toBe(whileDragging);
  });
});
