import { useEffect, type RefObject } from 'react';

/**
 * Depth of the bands at the top and bottom of the viewport that pull it along.
 * Wide enough to hit while watching the drop indicator rather than the cursor,
 * narrow enough that the middle of a short list stays still.
 */
export const EDGE_SCROLL_ZONE_PX = 56;
/**
 * Top speed, reached at the very edge and easing to nothing at the inner end of
 * the band. Expressed per second, not per frame: a frame-based step scrolls
 * twice as fast on a 120 Hz display as on a 60 Hz one.
 */
export const EDGE_SCROLL_MAX_PX_PER_SEC = 700;

/**
 * Signed scroll speed for a pointer at `clientY`, or 0 to stand still.
 * Exported for the test, which would otherwise have to drive animation frames
 * to observe a ramp.
 */
export function edgeScrollSpeed(clientY: number, rect: DOMRect): number {
  // Past an edge entirely — the pointer has left the list on its way further
  // up or down, which is the clearest possible request to keep going.
  if (clientY < rect.top) return -EDGE_SCROLL_MAX_PX_PER_SEC;
  if (clientY > rect.bottom) return EDGE_SCROLL_MAX_PX_PER_SEC;

  const fromTop = clientY - rect.top;
  if (fromTop < EDGE_SCROLL_ZONE_PX) {
    return -EDGE_SCROLL_MAX_PX_PER_SEC * (1 - fromTop / EDGE_SCROLL_ZONE_PX);
  }
  const fromBottom = rect.bottom - clientY;
  if (fromBottom < EDGE_SCROLL_ZONE_PX) {
    return EDGE_SCROLL_MAX_PX_PER_SEC * (1 - fromBottom / EDGE_SCROLL_ZONE_PX);
  }
  return 0;
}

/**
 * Scrolls `viewportRef` while a drag hovers near its top or bottom edge, so a
 * track can be moved further than one screenful without dropping it, scrolling
 * and picking it up again (issue #1592).
 *
 * Only runs while `enabled`, which callers tie to "a drag this list accepts is
 * in flight" — the listener is global, because the drag system moves the
 * pointer over a ghost that sits above every row and so the list itself sees no
 * pointer events during a drag.
 *
 * Horizontal position is part of the test: a drag crossing the window well
 * beside the list must not drag the list along with it.
 */
export function useDragEdgeScroll(
  viewportRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    let speed = 0;
    let frame = 0;
    // `null` rather than 0 for "no frame yet": a timestamp of 0 is a legal
    // first frame, and treating it as the sentinel stops the clock for good.
    let lastFrameAt: number | null = null;

    const step = (now: number) => {
      // The first frame has no interval to integrate over, so it only sets the
      // clock; scrolling starts on the second.
      const seconds = lastFrameAt === null ? 0 : (now - lastFrameAt) / 1000;
      lastFrameAt = now;
      if (speed !== 0 && seconds > 0) viewport.scrollTop += speed * seconds;
      frame = requestAnimationFrame(step);
    };

    const onMove = (event: MouseEvent) => {
      const rect = viewport.getBoundingClientRect();
      const besideTheList = event.clientX < rect.left || event.clientX > rect.right;
      speed = besideTheList ? 0 : edgeScrollSpeed(event.clientY, rect);
    };

    document.addEventListener('mousemove', onMove);
    frame = requestAnimationFrame(step);
    return () => {
      document.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(frame);
      // Belt and braces: a frame already handed to the browser still runs its
      // callback after the cancel in some engines, and a list that keeps
      // sliding after the drag ended is worse than one that never moved.
      speed = 0;
    };
  }, [viewportRef, enabled]);
}
