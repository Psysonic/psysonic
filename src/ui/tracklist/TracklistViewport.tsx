import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * Height the sticky header covers at the top of the scroll area. Rows reached
 * with the keyboard are kept below it (`scrollPaddingStart` on virtual lists,
 * `scroll-margin-top` in tracklist-model-a.css — keep both in step).
 */
export const TRACKLIST_STICKY_HEADER_PX = 48;

/** Pixels per line for wheel events that count in lines instead of pixels. */
const WHEEL_LINE_PX = 16;

interface Props {
  header: React.ReactNode;
  /** Sum of the visible column widths in px. */
  contentWidth: number;
  children: React.ReactNode;
}

/**
 * Horizontal frame of a track table. The page scrolls vertically; this frame
 * only handles sideways scrolling when the columns are wider than the view:
 *
 * - the header sits in its own clipped box so it can later stick to the top
 *   of the page without being trapped by the rows' scroll box;
 * - the rows scroll sideways natively (touchpad, Shift+wheel) with their own
 *   bar hidden;
 * - a thin bar sticks to the bottom of the visible area for as long as the
 *   table is on screen, so it is reachable without scrolling to the last row.
 *
 * All three share one `scrollLeft`.
 */
export function TracklistViewport({ header, contentWidth, children }: Props) {
  const headRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => setOverflow(contentWidth > body.clientWidth + 0.5);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    return () => ro.disconnect();
  }, [contentWidth]);

  // A freshly shown bar starts where the rows already are.
  useLayoutEffect(() => {
    if (overflow && barRef.current && bodyRef.current) {
      barRef.current.scrollLeft = bodyRef.current.scrollLeft;
    }
  }, [overflow]);

  const align = useCallback((x: number) => {
    const body = bodyRef.current;
    const bar = barRef.current;
    const head = headRef.current;
    if (body && body.scrollLeft !== x) body.scrollLeft = x;
    if (bar && bar.scrollLeft !== x) bar.scrollLeft = x;
    if (head && head.scrollLeft !== x) head.scrollLeft = x;
  }, []);

  // The header box clips instead of scrolling, so a sideways swipe or Shift +
  // wheel over it is handed to the rows. A plain vertical wheel stays the page's.
  const onHeadWheel = useCallback((e: React.WheelEvent) => {
    const body = bodyRef.current;
    if (!body) return;
    const raw = e.deltaX !== 0 ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (raw === 0) return;
    const unit = e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? body.clientWidth : 1;
    body.scrollLeft += raw * unit;
    align(body.scrollLeft);
  }, [align]);

  // Layout boxes only: inside a `role="table"` they must not stand between the
  // table and its rows.
  return (
    <div className="tl-viewport" role="presentation">
      <div
        className="tl-head-clip"
        role="presentation"
        ref={headRef}
        onScroll={e => align(e.currentTarget.scrollLeft)}
        onWheel={onHeadWheel}
      >
        <div role="presentation" style={{ width: contentWidth, minWidth: '100%' }}>{header}</div>
      </div>
      <div
        className="tl-body"
        role="presentation"
        ref={bodyRef}
        onScroll={e => align(e.currentTarget.scrollLeft)}
      >
        <div role="presentation" style={{ width: contentWidth, minWidth: '100%' }}>{children}</div>
      </div>
      {overflow && (
        <div
          className="tl-hbar"
          ref={barRef}
          tabIndex={-1}
          aria-hidden="true"
          onScroll={e => align(e.currentTarget.scrollLeft)}
        >
          <div style={{ width: contentWidth, height: 1 }} />
        </div>
      )}
    </div>
  );
}
