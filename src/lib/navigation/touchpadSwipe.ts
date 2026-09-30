/**
 * Two-finger horizontal touchpad swipe → history back / forward, the way
 * Firefox does it. The webview only sees a swipe as a stream of `wheel`
 * events with a horizontal delta, so this groups them into gestures and
 * reports one direction per gesture.
 *
 * - A gesture is a run of wheel events with no pause longer than
 *   {@link SWIPE_GESTURE_GAP_MS}; the macOS momentum tail stays in the same
 *   gesture, so one flick never navigates twice.
 * - A gesture that starts over something that scrolls sideways (a carousel,
 *   a wide table, a text field) belongs to that element and never navigates,
 *   even once the element hits its edge.
 * - Modified wheel input (Shift = horizontal mouse scroll, Ctrl/Meta = pinch
 *   or zoom, Alt) is left alone, and so is input inside a modal dialog.
 */

/** Horizontal travel (px) a gesture needs before it navigates. */
export const SWIPE_DISTANCE_PX = 150;
/** A pause longer than this ends the current gesture. */
export const SWIPE_GESTURE_GAP_MS = 250;
/** Horizontal travel must beat vertical travel by this factor. */
const SWIPE_DOMINANCE = 2;
const LINE_HEIGHT_PX = 16;

export type SwipeDirection = 'back' | 'forward';

export interface SwipeWheelInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  defaultPrevented: boolean;
  target: EventTarget | null;
  timeStamp: number;
}

function toPixels(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * LINE_HEIGHT_PX;
  if (deltaMode === 2) return delta * (window.innerWidth || 800);
  return delta;
}

function scrollsHorizontally(el: Element): boolean {
  if (el.scrollWidth <= el.clientWidth) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true;
  const overflowX = getComputedStyle(el).overflowX;
  return overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay';
}

/** True when the wheel target, or an ancestor of it, owns horizontal scrolling. */
export function isInsideHorizontalScroller(target: EventTarget | null): boolean {
  let el: Element | null = target instanceof Element
    ? target
    : (target as Node | null)?.parentElement ?? null;
  while (el && el !== document.documentElement) {
    if (el instanceof HTMLInputElement && el.type === 'range') return true;
    if (scrollsHorizontally(el)) return true;
    el = el.parentElement;
  }
  return false;
}

function isInsideModal(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : (target as Node | null)?.parentElement;
  return Boolean(el?.closest('[aria-modal="true"]'));
}

export interface SwipeTracker {
  /** Feed one wheel event; returns a direction when the gesture completes a swipe. */
  onWheel: (e: SwipeWheelInput) => SwipeDirection | null;
}

export function createSwipeTracker(): SwipeTracker {
  let lastTime = -Infinity;
  let sumX = 0;
  let sumY = 0;
  // Once a gesture navigated or was claimed by a scroller, it is done.
  let settled = false;

  return {
    onWheel(e) {
      if (e.timeStamp - lastTime > SWIPE_GESTURE_GAP_MS) {
        sumX = 0;
        sumY = 0;
        settled = false;
        if (
          e.defaultPrevented
          || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey
          || isInsideModal(e.target)
          || isInsideHorizontalScroller(e.target)
        ) {
          settled = true;
        }
      }
      lastTime = e.timeStamp;
      if (settled) return null;

      sumX += toPixels(e.deltaX, e.deltaMode);
      sumY += toPixels(e.deltaY, e.deltaMode);
      if (Math.abs(sumX) < SWIPE_DISTANCE_PX) return null;
      if (Math.abs(sumX) < Math.abs(sumY) * SWIPE_DOMINANCE) {
        // A diagonal vertical scroll, not a swipe.
        settled = true;
        return null;
      }
      settled = true;
      // Fingers moving right scroll content left (negative deltaX) — like
      // turning back a page.
      return sumX < 0 ? 'back' : 'forward';
    },
  };
}
