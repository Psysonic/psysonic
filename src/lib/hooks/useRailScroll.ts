import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Tolerance in px before a rail counts as scrollable. Sub-pixel layout rounding
 * would otherwise arm the "next" arrow on a row that has nothing to reveal.
 */
const RAIL_OVERFLOW_SLACK_PX = 5;

/**
 * How often a row may pull another page to cover its own width before giving up.
 * A wide window fits far more cards than one page holds; without a cap a very
 * wide monitor would keep paging until the section is exhausted.
 */
const MAX_AUTO_FILL_ROUNDS = 4;

export interface UseRailScrollOptions {
  /** The scrolling `.album-grid` element. Owned by the row so its other
      measurements (artwork windowing, scroll restore) can read it too. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Items currently rendered in the row. Re-measures and re-arms auto-fill. */
  itemCount: number;
  /** Row data identity. Changing it restarts the auto-fill budget. */
  resetKey?: string;
  /** False while the nav buttons are suppressed. */
  enabled?: boolean;
  /**
   * Loads the next page. Called only while the row does *not* overflow, so a
   * window wider than one page still reaches the rest of the section: the only
   * other trigger is horizontal scrolling, which a row without a scrollbar can
   * never produce.
   */
  onFillWidth?: () => Promise<void>;
  /** Extra work to run whenever the row is measured (viewport-dependent state). */
  onLayoutChange?: () => void;
}

export interface RailScroll {
  showLeft: boolean;
  showRight: boolean;
  /** Re-reads the scroll offsets. Call it from the row's own `onScroll`. */
  measure: () => void;
  scrollByPage: (dir: 'left' | 'right') => void;
}

/**
 * Horizontal rail plumbing shared by every `.album-grid` row: arrow state, the
 * observers that keep it honest, and paging by button.
 */
export function useRailScroll({
  scrollRef,
  itemCount,
  resetKey = '',
  enabled = true,
  onFillWidth,
  onLayoutChange,
}: UseRailScrollOptions): RailScroll {
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(true);

  const fillRoundsRef = useRef(0);
  const fillingRef = useRef(false);
  const lastFilledCountRef = useRef(-1);
  const itemCountRef = useRef(itemCount);
  const fillWidthRef = useRef(onFillWidth);
  const layoutChangeRef = useRef(onLayoutChange);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    itemCountRef.current = itemCount;
    fillWidthRef.current = onFillWidth;
    layoutChangeRef.current = onLayoutChange;
    enabledRef.current = enabled;
  });

  const measure = useCallback(() => {
    layoutChangeRef.current?.();
    const el = scrollRef.current;
    if (!el || !enabledRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setShowLeft(scrollLeft > 0);
    setShowRight(scrollLeft < scrollWidth - clientWidth - RAIL_OVERFLOW_SLACK_PX);
  }, [scrollRef]);

  const overflows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return false;
    return el.scrollWidth > el.clientWidth + RAIL_OVERFLOW_SLACK_PX;
  }, [scrollRef]);

  const fillWidth = useCallback(async () => {
    const fill = fillWidthRef.current;
    if (!fill || fillingRef.current) return;
    if (!scrollRef.current || overflows()) return;
    if (fillRoundsRef.current >= MAX_AUTO_FILL_ROUNDS) return;
    // The previous round returned nothing new — the section has no more rows.
    if (lastFilledCountRef.current === itemCountRef.current) return;

    fillRoundsRef.current += 1;
    lastFilledCountRef.current = itemCountRef.current;
    fillingRef.current = true;
    try {
      await fill();
    } finally {
      fillingRef.current = false;
    }
  }, [overflows, scrollRef]);

  useEffect(() => {
    fillRoundsRef.current = 0;
    lastFilledCountRef.current = -1;
  }, [resetKey]);

  useEffect(() => {
    measure();
    // Cards need a frame to lay out before their width can decide anything.
    const raf = window.requestAnimationFrame(() => {
      measure();
      void fillWidth();
    });

    const onViewportResize = () => {
      measure();
      void fillWidth();
    };
    window.addEventListener('resize', onViewportResize);

    // The row can also change width without the window doing so — a collapsing
    // sidebar or the queue panel opening beside it.
    const observer = new ResizeObserver(onViewportResize);
    const el = scrollRef.current;
    if (el) observer.observe(el);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', onViewportResize);
      observer.disconnect();
    };
  }, [itemCount, resetKey, enabled, measure, fillWidth, scrollRef]);

  const scrollByPage = useCallback((dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.75;
    el.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' });
  }, [scrollRef]);

  return { showLeft, showRight, measure, scrollByPage };
}
