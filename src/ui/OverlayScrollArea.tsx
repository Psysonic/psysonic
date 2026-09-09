import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { computeOverlayScrollbarThumbMeta } from '@/lib/dom/overlayScrollbarMetrics';
import { bindOverlayScrollbarThumbDrag } from '@/lib/dom/overlayScrollbarThumb';
import { usePerfProbeFlags } from '@/lib/perf/perfFlags';

export type OverlayScrollRailInset = 'none' | 'mini' | 'panel';

export type OverlayScrollAreaProps = {
  children: React.ReactNode;
  /** Optional handler on the outer wrapper (e.g. mini queue DnD hit-testing). */
  onMouseMove?: React.MouseEventHandler<HTMLDivElement>;
  /** Classes on the outer wrapper (e.g. queue-list-wrap, mini-queue-wrap). */
  className?: string;
  /** Classes on the scrollable viewport (e.g. queue-list, mini-queue). */
  viewportClassName?: string;
  /** Serialized internally — triggers remeasure + ResizeObserver refresh. */
  measureDeps?: ReadonlyArray<unknown>;
  /** Vertical inset of the hit rail (align with viewport padding). */
  railInset?: OverlayScrollRailInset;
  /** e.g. during native DnD — scroll-behavior: auto on the viewport. */
  viewportScrollBehaviorAuto?: boolean;
  /** Ref to the scrollable element (querySelector, scrollIntoView, etc.). */
  viewportRef?: React.Ref<HTMLDivElement>;
  /** Ref to the outer wrapper (incl. overlay scrollbar rail). */
  wrapRef?: React.Ref<HTMLDivElement>;
  /** Optional id on the viewport (e.g. main app scroll for route pages). */
  viewportId?: string;
  /** Optional wheel handler on the scrollable viewport. */
  viewportOnWheel?: React.WheelEventHandler<HTMLDivElement>;
  /** Optional touch-move handler on the scrollable viewport. */
  viewportOnTouchMove?: React.TouchEventHandler<HTMLDivElement>;
};

export type OverlayTextareaProps = Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  'children' | 'ref'
> & {
  /** Classes on the outer wrapper around the textarea and overlay rail. */
  wrapClassName?: string;
  /** Vertical inset of the hit rail. */
  railInset?: OverlayScrollRailInset;
};

const RAIL_INSET_CLASS: Record<OverlayScrollRailInset, string> = {
  none: 'overlay-scroll--rail-inset-none',
  mini: 'overlay-scroll--rail-inset-mini',
  panel: 'overlay-scroll--rail-inset-panel',
};

function assignRef<T>(ref: React.Ref<T> | undefined, value: T) {
  if (ref == null) return;
  if (typeof ref === 'function') ref(value);
  else (ref as { current: T | null }).current = value;
}

function overlayRootClass(
  railInset: OverlayScrollRailInset,
  className: string,
  viewportScrollBehaviorAuto = false,
) {
  return [
    'overlay-scroll',
    RAIL_INSET_CLASS[railInset],
    viewportScrollBehaviorAuto ? 'overlay-scroll--viewport-scroll-auto' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
}

function useOverlayScrollbar<T extends HTMLElement>(measureDeps: ReadonlyArray<unknown>) {
  const perfFlags = usePerfProbeFlags();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<T | null>(null);
  const scrollRecomputeRafRef = useRef(0);
  const [meta, setMeta] = useState({ thumbH: 0, thumbT: 0, visible: false });

  const recompute = useCallback(() => {
    const viewport = viewportRef.current;
    const rail = wrapRef.current?.querySelector<HTMLElement>('.overlay-scroll__rail');
    const trackHeight = rail && rail.clientHeight > 0 ? rail.clientHeight : undefined;
    setMeta(computeOverlayScrollbarThumbMeta(viewport, trackHeight));
  }, []);

  const scheduleScrollRecompute = useCallback(() => {
    if (scrollRecomputeRafRef.current !== 0) return;
    scrollRecomputeRafRef.current = requestAnimationFrame(() => {
      scrollRecomputeRafRef.current = 0;
      recompute();
    });
  }, [recompute]);

  useEffect(() => () => {
    if (scrollRecomputeRafRef.current !== 0) {
      cancelAnimationFrame(scrollRecomputeRafRef.current);
      scrollRecomputeRafRef.current = 0;
    }
  }, []);

  const measureKey = JSON.stringify(measureDeps);

  useLayoutEffect(() => {
    if (perfFlags.disableOverlayScrollbars || !meta.visible) return;
    const viewport = viewportRef.current;
    const rail = wrapRef.current?.querySelector<HTMLElement>('.overlay-scroll__rail');
    const trackHeight = rail?.clientHeight;
    if (!viewport || !trackHeight || trackHeight <= 0) return;
    setMeta((previous) => {
      const next = computeOverlayScrollbarThumbMeta(viewport, trackHeight);
      if (
        previous.thumbH === next.thumbH
        && previous.thumbT === next.thumbT
        && previous.visible === next.visible
      ) {
        return previous;
      }
      return next;
    });
  }, [meta.visible, perfFlags.disableOverlayScrollbars]);

  useEffect(() => {
    if (perfFlags.disableOverlayScrollbars) return;
    recompute();
    const wrap = wrapRef.current;
    const onWindowResize = () => recompute();
    window.addEventListener('resize', onWindowResize);
    const resizeObserver = typeof ResizeObserver !== 'undefined' && wrap
      ? new ResizeObserver(() => recompute())
      : null;
    if (resizeObserver && wrap) resizeObserver.observe(wrap);
    return () => {
      window.removeEventListener('resize', onWindowResize);
      resizeObserver?.disconnect();
    };
  }, [recompute, measureKey, perfFlags.disableOverlayScrollbars]);

  const setViewportNode = useCallback((element: T | null) => {
    viewportRef.current = element;
  }, []);

  const setWrapNode = useCallback((element: HTMLDivElement | null) => {
    wrapRef.current = element;
  }, []);

  const getViewportNode = useCallback(() => viewportRef.current, []);

  return {
    disabled: perfFlags.disableOverlayScrollbars,
    getViewportNode,
    meta,
    scheduleScrollRecompute,
    setViewportNode,
    setWrapNode,
  };
}

function OverlayScrollbarRail({
  disabled,
  getViewportNode,
  meta,
}: {
  disabled: boolean;
  getViewportNode: () => HTMLElement | null;
  meta: { thumbH: number; thumbT: number; visible: boolean };
}) {
  if (disabled || !meta.visible) return null;

  return (
    <div className="overlay-scroll__rail" aria-hidden>
      <div
        className="overlay-scroll__thumb"
        style={{
          height: `${meta.thumbH}px`,
          transform: `translateY(${meta.thumbT}px)`,
        }}
        onPointerDown={event => bindOverlayScrollbarThumbDrag(event, getViewportNode())}
      />
    </div>
  );
}

export function OverlayTextarea({
  className = '',
  wrapClassName = '',
  railInset = 'panel',
  onScroll,
  value,
  defaultValue,
  rows,
  ...props
}: OverlayTextareaProps) {
  const {
    disabled,
    getViewportNode,
    meta,
    scheduleScrollRecompute,
    setViewportNode,
    setWrapNode,
  } = useOverlayScrollbar<HTMLTextAreaElement>([value, defaultValue, rows]);
  const viewportClass = ['overlay-scroll__viewport', className].filter(Boolean).join(' ');

  return (
    <div
      ref={setWrapNode}
      className={overlayRootClass(railInset, `overlay-textarea ${wrapClassName}`)}
    >
      <textarea
        {...props}
        ref={setViewportNode}
        className={viewportClass}
        value={value}
        defaultValue={defaultValue}
        rows={rows}
        onScroll={(event) => {
          if (!disabled) scheduleScrollRecompute();
          onScroll?.(event);
        }}
      />
      <OverlayScrollbarRail
        disabled={disabled}
        getViewportNode={getViewportNode}
        meta={meta}
      />
    </div>
  );
}

export default function OverlayScrollArea({
  children,
  onMouseMove,
  className = '',
  viewportClassName = '',
  measureDeps = [],
  railInset = 'none',
  viewportScrollBehaviorAuto = false,
  viewportRef: viewportRefProp,
  wrapRef: wrapRefProp,
  viewportId,
  viewportOnWheel,
  viewportOnTouchMove,
}: OverlayScrollAreaProps) {
  const {
    disabled,
    getViewportNode,
    meta,
    scheduleScrollRecompute,
    setViewportNode,
    setWrapNode,
  } = useOverlayScrollbar<HTMLDivElement>(measureDeps);
  const viewportClass = ['overlay-scroll__viewport', viewportClassName].filter(Boolean).join(' ');

  const bindViewportNode = (element: HTMLDivElement | null) => {
    setViewportNode(element);
    assignRef(viewportRefProp, element);
  };

  const bindWrapNode = (element: HTMLDivElement | null) => {
    setWrapNode(element);
    assignRef(wrapRefProp, element);
  };

  return (
    <div
      ref={bindWrapNode}
      className={overlayRootClass(railInset, className, viewportScrollBehaviorAuto)}
      onMouseMove={onMouseMove}
    >
      <div
        id={viewportId}
        ref={bindViewportNode}
        className={viewportClass}
        onScroll={disabled ? undefined : scheduleScrollRecompute}
        onWheel={viewportOnWheel}
        onTouchMove={viewportOnTouchMove}
      >
        {children}
      </div>
      <OverlayScrollbarRail
        disabled={disabled}
        getViewportNode={getViewportNode}
        meta={meta}
      />
    </div>
  );
}
