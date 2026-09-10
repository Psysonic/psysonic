import { useEffect } from 'react';

/**
 * How close to an edge the cursor has to get before the list starts moving.
 *
 * Deep enough to hit without aiming, shallow enough that the bottom row is
 * still a place you can drop something.
 */
const EDGE_PX = 48;

/** Pixels per frame at the very edge, easing to nothing at the zone's inner lip. */
const MAX_SPEED_PX = 18;

/**
 * Scroll the running order while a row is being dragged past its edge.
 *
 * A CD holds up to 99 tracks and the panel shows a dozen, so without this the
 * only way to move a track from the end of a long queue to the front is to
 * drop it, scroll, pick it up again, and repeat. The list has never had it.
 *
 * The listener is on `document` rather than the viewport on purpose: the whole
 * point is that the pointer has left the list, and a listener on the element
 * being scrolled stops hearing about it exactly when it matters. It is bound
 * only while a drag is live, so an idle page costs nothing.
 */
export function useBurnListAutoscroll(
  viewportRef: React.RefObject<HTMLElement | null>,
  isDragging: boolean,
): void {
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!isDragging || !viewport) return;

    // Written by the pointer, read by the frame loop. Keeping the two apart is
    // what stops a fast mouse queueing a frame per event.
    let speed = 0;
    let raf = 0;

    const onMove = (event: MouseEvent) => {
      const box = viewport.getBoundingClientRect();
      const fromTop = event.clientY - box.top;
      const fromBottom = box.bottom - event.clientY;

      if (fromTop < EDGE_PX) {
        // Hardest at the edge itself, and past the edge it simply stays at full
        // speed rather than reversing on a negative distance.
        speed = -MAX_SPEED_PX * Math.min(1, Math.max(0, 1 - fromTop / EDGE_PX));
      } else if (fromBottom < EDGE_PX) {
        speed = MAX_SPEED_PX * Math.min(1, Math.max(0, 1 - fromBottom / EDGE_PX));
      } else {
        speed = 0;
      }
    };

    const frame = () => {
      if (speed !== 0) viewport.scrollTop += speed;
      raf = requestAnimationFrame(frame);
    };

    document.addEventListener('mousemove', onMove);
    raf = requestAnimationFrame(frame);

    return () => {
      document.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(raf);
    };
  }, [viewportRef, isDragging]);
}
