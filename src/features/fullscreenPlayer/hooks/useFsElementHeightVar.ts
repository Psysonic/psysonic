import { useEffect, type RefObject } from 'react';

/**
 * Publishes the measured height of one element as a CSS variable on the
 * fullscreen player's root, so a sibling layer can be sized against what is
 * actually rendered instead of reserving a fixed amount of space for it.
 *
 * Both fullscreen players need this for the same reason: their bottom clusters
 * have no fixed height. The cover is sized in `vh`, the visualizer strip is only
 * mounted while it is switched on, a title can wrap, and the "Next" line only
 * appears when the queue has one. A constant matches exactly one of those
 * combinations — which is how the lyrics ended up on top of the track title
 * (issue #1546).
 *
 * The variable is removed on cleanup so a stale value cannot outlive the element
 * it was measured from; the CSS keeps a fallback for the first paint.
 */
export function useFsElementHeightVar(
  rootRef: RefObject<HTMLElement | null>,
  elementRef: RefObject<HTMLElement | null>,
  varName: string,
): void {
  useEffect(() => {
    const root = rootRef.current;
    const element = elementRef.current;
    if (!root || !element) return;

    const publish = () => {
      const height = Math.round(element.getBoundingClientRect().height);
      root.style.setProperty(varName, `${height}px`);
    };

    publish();

    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty(varName);
    };
  }, [rootRef, elementRef, varName]);
}
