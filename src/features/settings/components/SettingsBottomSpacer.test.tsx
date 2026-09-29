import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { SettingsBottomSpacer } from '@/features/settings/components/SettingsBottomSpacer';
import { APP_MAIN_SCROLL_VIEWPORT_ID } from '@/constants/appScroll';

const VIEWPORT_HEIGHT = 600;
const CONTENT_HEIGHT = 2000;
/** Long enough to trip it; the component asks for 3 s. */
const LONG_HOLD_MS = 3000;
const SHORT_HOLD_MS = 2000;
/** Interval between wheel events, roughly what a wheel held down produces. */
const WHEEL_INTERVAL_MS = 150;
const BITMAP_SIZE = 32;
/** jsdom defaults to 768; pin it so the scale the component picks is stable. */
const WINDOW_HEIGHT = 800;

/**
 * jsdom reports every scroll metric as 0, which reads as "already at the bottom
 * stop". Pin all three so both sides of that check are exercised for real.
 */
function mountViewport(scrollTop: number): HTMLElement {
  const viewport = document.createElement('div');
  viewport.id = APP_MAIN_SCROLL_VIEWPORT_ID;
  document.body.appendChild(viewport);
  Object.defineProperty(viewport, 'clientHeight', { value: VIEWPORT_HEIGHT, configurable: true });
  Object.defineProperty(viewport, 'scrollHeight', { value: CONTENT_HEIGHT, configurable: true });
  Object.defineProperty(viewport, 'scrollTop', { value: scrollTop, writable: true, configurable: true });
  return viewport;
}

const atFloor = () => mountViewport(CONTENT_HEIGHT - VIEWPORT_HEIGHT);

/** Keeps the wheel turning for `ms`, in the steps a real wheel produces. */
function hold(viewport: HTMLElement, ms: number, deltaY = 120): void {
  for (let elapsed = 0; elapsed <= ms; elapsed += WHEEL_INTERVAL_MS) {
    fireEvent.wheel(viewport, { deltaY });
    vi.advanceTimersByTime(WHEEL_INTERVAL_MS);
  }
}

interface Painted { x: number; y: number; colour: string; alpha: number }

/**
 * jsdom has no 2d context, so the drawing path would never run — and a mistyped
 * bitmap row would only ever surface in a browser. Hand it a recorder instead
 * and assert on what came out.
 */
function recordPainting({ still, frameTime = 1000 }: { still: boolean; frameTime?: number }): Painted[] {
  const painted: Painted[] = [];
  const ctx = {
    fillStyle: '',
    globalAlpha: 1,
    clearRect: () => {},
    fillRect: (x: number, y: number) =>
      painted.push({ x, y, colour: String(ctx.fillStyle), alpha: ctx.globalAlpha }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.stubGlobal('matchMedia', () => ({ matches: still }));
  // Run only the first frame; the paint loop re-arms itself when animating.
  let frames = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    if (frames++ === 0) cb(frameTime);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  return painted;
}

const setWindowHeight = (px: number) =>
  Object.defineProperty(window, 'innerHeight', { value: px, configurable: true });

/** The scale the component settled on, read back off the canvas it sized. */
function renderedScale(): number {
  const canvas = document.querySelector('canvas');
  if (!canvas) throw new Error('no canvas was rendered');
  return canvas.width / BITMAP_SIZE;
}

beforeEach(() => {
  vi.useFakeTimers();
  setWindowHeight(WINDOW_HEIGHT);
});

afterEach(() => {
  vi.useRealTimers();
  document.getElementById(APP_MAIN_SCROLL_VIEWPORT_ID)?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SettingsBottomSpacer', () => {
  it('stays quiet for the couple of notches everyone lands on at the end of a page', () => {
    const viewport = atFloor();
    renderWithProviders(<SettingsBottomSpacer />);

    hold(viewport, 400);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens after the wheel has pushed against the stop long enough', () => {
    const viewport = atFloor();
    renderWithProviders(<SettingsBottomSpacer />);

    hold(viewport, LONG_HOLD_MS);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('ignores the same push while the page still has room to scroll', () => {
    const viewport = mountViewport(0);
    renderWithProviders(<SettingsBottomSpacer />);

    hold(viewport, LONG_HOLD_MS * 2);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('starts over on an upward wheel', () => {
    const viewport = atFloor();
    renderWithProviders(<SettingsBottomSpacer />);

    hold(viewport, SHORT_HOLD_MS);
    fireEvent.wheel(viewport, { deltaY: -120 });
    hold(viewport, SHORT_HOLD_MS);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('starts over when the push lets up, so it has to be one continuous hold', () => {
    const viewport = atFloor();
    renderWithProviders(<SettingsBottomSpacer />);

    hold(viewport, SHORT_HOLD_MS);
    vi.advanceTimersByTime(800);
    hold(viewport, SHORT_HOLD_MS);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // A flick on a trackpad keeps firing as it coasts, with the delta decaying to
  // nothing. That tail must not count as someone leaning on the wheel.
  it('ignores a long tail of momentum notches', () => {
    const viewport = atFloor();
    renderWithProviders(<SettingsBottomSpacer />);

    hold(viewport, LONG_HOLD_MS * 2, 4);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on any key and does not come back in the same session', () => {
    const viewport = atFloor();
    renderWithProviders(<SettingsBottomSpacer />);
    hold(viewport, LONG_HOLD_MS);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    hold(viewport, LONG_HOLD_MS * 2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on a click as well', () => {
    const viewport = atFloor();
    renderWithProviders(<SettingsBottomSpacer />);
    hold(viewport, LONG_HOLD_MS);

    fireEvent.pointerDown(window);

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('SettingsBottomSpacer bitmap', () => {
  it('paints an aligned grid in a small fixed palette', () => {
    const painted = recordPainting({ still: true });
    const viewport = atFloor();
    renderWithProviders(<SettingsBottomSpacer />);
    hold(viewport, LONG_HOLD_MS);

    const scale = renderedScale();
    expect(painted.length).toBeGreaterThan(0);
    for (const cell of painted) {
      expect(cell.x % scale).toBe(0);
      expect(cell.y % scale).toBe(0);
      expect(cell.x).toBeLessThan(BITMAP_SIZE * scale);
      expect(cell.y).toBeLessThan(BITMAP_SIZE * scale);
      expect(cell.colour).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(new Set(painted.map(c => c.colour)).size).toBeLessThanOrEqual(10);
  });

  // Every row is mirrored by hand, so a typo that still decodes to the right
  // width shows up here and nowhere else.
  it('paints a left-right mirrored figure', () => {
    const painted = recordPainting({ still: true });
    const viewport = atFloor();
    renderWithProviders(<SettingsBottomSpacer />);
    hold(viewport, LONG_HOLD_MS);

    const right = (BITMAP_SIZE - 1) * renderedScale();
    const byCell = new Map(painted.map(c => [`${c.x},${c.y}`, c.colour]));
    expect(byCell.size).toBeGreaterThan(0);
    for (const cell of painted) {
      expect(byCell.get(`${right - cell.x},${cell.y}`)).toBe(cell.colour);
    }
  });

  it('holds the glow still when the system asks for reduced motion', () => {
    const painted = recordPainting({ still: true });
    const viewport = atFloor();
    renderWithProviders(<SettingsBottomSpacer />);
    hold(viewport, LONG_HOLD_MS);

    expect(painted.length).toBeGreaterThan(0);
    expect(painted.every(c => c.alpha === 1)).toBe(true);
  });

  it('pulses only the eyes otherwise', () => {
    const painted = recordPainting({ still: false });
    const viewport = atFloor();
    renderWithProviders(<SettingsBottomSpacer />);
    hold(viewport, LONG_HOLD_MS);

    const dimmed = painted.filter(c => c.alpha < 1);
    expect(dimmed.length).toBeGreaterThan(0);
    expect(dimmed.length).toBeLessThan(painted.length / 4);
    // The pulsing pixels are the two eye colours and nothing else.
    expect(new Set(dimmed.map(c => c.colour)).size).toBe(2);
  });

  it('scales the figure with the window height, in whole pixels', () => {
    setWindowHeight(1600);
    recordPainting({ still: true });
    const viewport = atFloor();
    renderWithProviders(<SettingsBottomSpacer />);
    hold(viewport, LONG_HOLD_MS);

    const scale = renderedScale();
    expect(Number.isInteger(scale)).toBe(true);
    expect(scale).toBe(20);
  });

  it('stops shrinking on a short window so the figure stays legible', () => {
    setWindowHeight(320);
    recordPainting({ still: true });
    const viewport = atFloor();
    renderWithProviders(<SettingsBottomSpacer />);
    hold(viewport, LONG_HOLD_MS);

    expect(renderedScale()).toBe(6);
  });
});
