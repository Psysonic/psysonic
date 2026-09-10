import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useBurnerLayoutStore } from '@/features/burner/store/burnerLayoutStore';
import {
  colsFor,
  maxSideWidth,
  KEY_STEP_COARSE_PX,
  KEY_STEP_PX,
  SIDE_DEFAULT_PX,
  SIDE_MAX_PX,
  SIDE_MIN_PX,
} from '@/features/burner/utils/burnStage';

/** Everything the seam needs but its label — those come from i18n in the component. */
export interface BurnSeamHandleProps {
  role: 'separator';
  'aria-orientation': 'vertical';
  'aria-valuenow': number;
  'aria-valuemin': number;
  'aria-valuemax': number;
  tabIndex: number;
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void;
}

export interface UseBurnerSplitArgs {
  /** The measured element. Every width decision on this page comes from it. */
  splitRef: React.RefObject<HTMLDivElement | null>;
  /** Carries `--burner-side-w`; the drag writes straight to its inline style. */
  pageRef: React.RefObject<HTMLDivElement | null>;
  /** False while a row drag owns the pointer, so the gutter cannot steal it. */
  enabled: boolean;
}

export interface UseBurnerSplitResult {
  cols: 1 | 2 | 3;
  /** What to render. The stored preference clamped to what fits, never saved. */
  sideWidth: number;
  effectiveMax: number;
  dragging: boolean;
  seamProps: BurnSeamHandleProps;
}

function clamp(min: number, value: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * The width regime, the seam, and the one number both of them are made of.
 *
 * The regime is *measured* on `.burner-split` rather than read off the window,
 * and that is the whole point of this hook. `.app-shell` is a grid of sidebar,
 * content and queue panel, so a 1440px window can leave this page 864px — a
 * window media query calls that wide and clips the running order off a page
 * that is `overflow: hidden`. One ResizeObserver feeds `data-cols` and the JS
 * clamp ceiling alike, so CSS and JS cannot disagree about where the page is.
 *
 * The stored width is the user's preference and is only ever clamped on the
 * way out. A laptop session must not be able to destroy a 700px list; widen
 * the window again and it comes back exactly.
 */
export function useBurnerSplit({ splitRef, pageRef, enabled }: UseBurnerSplitArgs): UseBurnerSplitResult {
  const storedWidth = useBurnerLayoutStore(s => s.sideWidth);
  const setStoredWidth = useBurnerLayoutStore(s => s.setSideWidth);
  const resetStoredWidth = useBurnerLayoutStore(s => s.resetSideWidth);

  const [splitWidth, setSplitWidth] = useState(0);
  const [dragging, setDragging] = useState(false);

  const cols = colsFor(splitWidth);
  const effectiveMax = maxSideWidth(splitWidth, cols);
  const sideWidth = Math.min(storedWidth, effectiveMax);

  // Read by the drag's window listeners, which are bound once per drag and
  // must not be rebound every time the window resizes underneath them.
  const effectiveMaxRef = useRef(SIDE_MAX_PX);
  const sideWidthRef = useRef(SIDE_DEFAULT_PX);
  const startXRef = useRef(0);
  const startWidthRef = useRef(SIDE_DEFAULT_PX);
  const liveWidthRef = useRef(SIDE_DEFAULT_PX);

  useEffect(() => {
    effectiveMaxRef.current = effectiveMax;
    sideWidthRef.current = sideWidth;
  }, [effectiveMax, sideWidth]);

  useEffect(() => {
    const el = splitRef.current;
    if (!el) return;

    let raf = 0;
    let latest = el.getBoundingClientRect().width;

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) latest = entry.contentRect.width;
      // A resize storm (dragging the app's own queue panel) fires far faster
      // than the page can usefully re-render; one measurement per frame is
      // all the layout can act on.
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setSplitWidth(latest);
      });
    });
    observer.observe(el);

    setSplitWidth(latest);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [splitRef]);

  /** The drag never re-renders: a tree with the disc and 99 rows in it cannot afford 60Hz. */
  const paintWidth = useCallback((px: number) => {
    liveWidthRef.current = px;
    pageRef.current?.style.setProperty('--burner-side-w', `${px}px`);
  }, [pageRef]);

  const releaseDragChrome = useCallback(() => {
    document.body.style.cursor = '';
    document.body.classList.remove('is-dragging');
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (event: MouseEvent) => {
      // The list is on the right, so pulling the seam left widens it.
      const next = clamp(
        SIDE_MIN_PX,
        startWidthRef.current + (startXRef.current - event.clientX),
        effectiveMaxRef.current,
      );
      paintWidth(next);
    };

    const onUp = () => {
      setStoredWidth(liveWidthRef.current);
      releaseDragChrome();
      setDragging(false);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.classList.add('is-dragging');

    // `global-dragging-state.css` puts `cursor: col-resize` on every element
    // under `body.is-dragging`, so leaving the page mid-drag without this
    // would strand a resize cursor over the whole app.
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      releaseDragChrome();
    };
  }, [dragging, paintWidth, releaseDragChrome, setStoredWidth]);

  const onMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!enabled || cols === 1 || event.button !== 0) return;
    event.preventDefault();
    startXRef.current = event.clientX;
    startWidthRef.current = sideWidthRef.current;
    liveWidthRef.current = sideWidthRef.current;
    setDragging(true);
  }, [enabled, cols]);

  const resetWidth = useCallback(() => {
    resetStoredWidth();
  }, [resetStoredWidth]);

  const onDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!enabled || cols === 1) return;
    event.preventDefault();
    resetWidth();
  }, [enabled, cols, resetWidth]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!enabled || cols === 1) return;

    const step = event.shiftKey ? KEY_STEP_COARSE_PX : KEY_STEP_PX;
    const current = sideWidthRef.current;
    // No initialiser: every case below either assigns it or returns, so a
    // starting value would be one the code can never read.
    let next: number;

    // The WAI-ARIA window splitter: an arrow moves the separator the way it
    // points, and the running order is what the movement gives or takes.
    switch (event.key) {
      case 'ArrowLeft':  next = current + step; break;
      case 'ArrowRight': next = current - step; break;
      case 'Home':       next = SIDE_MIN_PX; break;
      case 'End':        next = effectiveMaxRef.current; break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        resetWidth();
        return;
      default: return;
    }

    // Arrows would otherwise scroll the page out from under the seam.
    event.preventDefault();
    // Discrete keystrokes are not a 60Hz stream, so each one commits.
    setStoredWidth(clamp(SIDE_MIN_PX, next, effectiveMaxRef.current));
  }, [enabled, cols, resetWidth, setStoredWidth]);

  const seamProps: BurnSeamHandleProps = {
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-valuenow': sideWidth,
    'aria-valuemin': SIDE_MIN_PX,
    'aria-valuemax': effectiveMax,
    tabIndex: 0,
    onMouseDown,
    onKeyDown,
    onDoubleClick,
  };

  return { cols, sideWidth, effectiveMax, dragging, seamProps };
}
