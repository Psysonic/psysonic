import { afterEach, describe, expect, it } from 'vitest';
import {
  createSwipeTracker,
  isInsideHorizontalScroller,
  SWIPE_DISTANCE_PX,
  SWIPE_GESTURE_GAP_MS,
  type SwipeWheelInput,
} from './touchpadSwipe';

function wheel(overrides: Partial<SwipeWheelInput> = {}): SwipeWheelInput {
  return {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    defaultPrevented: false,
    target: document.body,
    timeStamp: 0,
    ...overrides,
  };
}

/** Feed a gesture of `steps` equal events 16 ms apart; return every non-null result. */
function swipe(
  tracker: ReturnType<typeof createSwipeTracker>,
  deltaX: number,
  steps: number,
  start = 0,
  extra: Partial<SwipeWheelInput> = {},
) {
  const results = [];
  for (let i = 0; i < steps; i++) {
    const r = tracker.onWheel(wheel({ deltaX, timeStamp: start + i * 16, ...extra }));
    if (r) results.push(r);
  }
  return results;
}

function makeScroller(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.overflowX = 'auto';
  Object.defineProperty(el, 'scrollWidth', { value: 1000 });
  Object.defineProperty(el, 'clientWidth', { value: 300 });
  const child = document.createElement('span');
  el.appendChild(child);
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createSwipeTracker', () => {
  it('goes back when content scrolls left (fingers move right)', () => {
    const tracker = createSwipeTracker();
    expect(swipe(tracker, -20, 10)).toEqual(['back']);
  });

  it('goes forward when content scrolls right', () => {
    const tracker = createSwipeTracker();
    expect(swipe(tracker, 20, 10)).toEqual(['forward']);
  });

  it('ignores a swipe shorter than the threshold', () => {
    const tracker = createSwipeTracker();
    expect(swipe(tracker, -10, Math.floor(SWIPE_DISTANCE_PX / 10) - 1)).toEqual([]);
  });

  it('navigates once per gesture, including its momentum tail', () => {
    const tracker = createSwipeTracker();
    expect(swipe(tracker, -20, 60)).toEqual(['back']);
  });

  it('allows a second navigation after a pause', () => {
    const tracker = createSwipeTracker();
    expect(swipe(tracker, -20, 10, 0)).toEqual(['back']);
    expect(swipe(tracker, -20, 10, 10 * 16 + SWIPE_GESTURE_GAP_MS + 1)).toEqual(['back']);
  });

  it('does not treat a diagonal vertical scroll as a swipe', () => {
    const tracker = createSwipeTracker();
    const results = [];
    for (let i = 0; i < 20; i++) {
      const r = tracker.onWheel(wheel({ deltaX: -10, deltaY: 30, timeStamp: i * 16 }));
      if (r) results.push(r);
    }
    expect(results).toEqual([]);
  });

  it('converts line-based deltas to pixels', () => {
    const tracker = createSwipeTracker();
    expect(swipe(tracker, -3, 4, 0, { deltaMode: 1 })).toEqual(['back']);
  });

  it.each([
    ['Shift', { shiftKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Meta', { metaKey: true }],
    ['Alt', { altKey: true }],
    ['a handled event', { defaultPrevented: true }],
  ])('leaves %s wheel input alone', (_name, extra) => {
    const tracker = createSwipeTracker();
    expect(swipe(tracker, -20, 10, 0, extra)).toEqual([]);
  });

  it('leaves input inside a modal dialog alone', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    const inner = document.createElement('img');
    dialog.appendChild(inner);
    document.body.appendChild(dialog);
    const tracker = createSwipeTracker();
    expect(swipe(tracker, -20, 10, 0, { target: inner })).toEqual([]);
  });

  it('leaves the whole gesture to a sideways scroller it started on', () => {
    const scroller = makeScroller();
    const tracker = createSwipeTracker();
    // Starts on the carousel, drifts off it mid-gesture: still no navigation.
    expect(tracker.onWheel(wheel({ deltaX: -20, target: scroller.firstChild, timeStamp: 0 }))).toBeNull();
    expect(swipe(tracker, -20, 10, 16)).toEqual([]);
  });
});

describe('isInsideHorizontalScroller', () => {
  it('detects an overflowing overflow-x container', () => {
    const scroller = makeScroller();
    expect(isInsideHorizontalScroller(scroller.firstChild)).toBe(true);
  });

  it('ignores a container whose content fits', () => {
    const el = document.createElement('div');
    el.style.overflowX = 'auto';
    document.body.appendChild(el);
    expect(isInsideHorizontalScroller(el)).toBe(false);
  });

  it('treats range sliders as horizontal controls', () => {
    const range = document.createElement('input');
    range.type = 'range';
    document.body.appendChild(range);
    expect(isInsideHorizontalScroller(range)).toBe(true);
  });
});
