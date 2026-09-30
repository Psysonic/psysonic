import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  LIGHTBOX_ZOOM_RESET,
  panBy,
  wheelZoomFactor,
  zoomAt,
  type LightboxZoom,
  type Point,
  type Size,
} from '@/ui/coverLightboxZoom';

interface Props {
  src: string;
  alt: string;
  onClose: () => void;
}

/** WebKit's trackpad pinch event (macOS); not in the DOM typings. */
interface GestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

const DOUBLE_CLICK_ZOOM = 2.5;

export default function CoverLightbox({ src, alt, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<Point | null>(null);
  const [zoom, setZoom] = useState<LightboxZoom>(LIGHTBOX_ZOOM_RESET);
  const zoomed = zoom.scale > 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Pinch / Ctrl+wheel zooms, two-finger scroll pans while zoomed. Native
  // listeners, because React's wheel listener is passive and cannot stop the
  // webview from zooming the whole page.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const imageSize = (): Size => ({
      width: imgRef.current?.offsetWidth ?? 0,
      height: imgRef.current?.offsetHeight ?? 0,
    });
    const anchorOf = (clientX: number, clientY: number): Point => {
      const rect = overlay.getBoundingClientRect();
      return { x: clientX - (rect.left + rect.width / 2), y: clientY - (rect.top + rect.height / 2) };
    };

    // WebKit sends a pinch as gesture events; ignore any Ctrl+wheel it may
    // send alongside so the pinch is not applied twice.
    let gestureScale: number | null = null;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const size = imageSize();
      if (e.ctrlKey || e.metaKey) {
        if (gestureScale !== null) return;
        const factor = wheelZoomFactor(e.deltaY, e.deltaMode);
        const anchor = anchorOf(e.clientX, e.clientY);
        setZoom(z => zoomAt(z, factor, anchor, size));
      } else {
        setZoom(z => panBy(z, -e.deltaX, -e.deltaY, size));
      }
    };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScale = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as GestureEvent;
      if (gestureScale === null || !g.scale) return;
      const factor = g.scale / gestureScale;
      gestureScale = g.scale;
      const size = imageSize();
      const anchor = anchorOf(g.clientX, g.clientY);
      setZoom(z => zoomAt(z, factor, anchor, size));
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureScale = null;
    };

    overlay.addEventListener('wheel', onWheel, { passive: false });
    overlay.addEventListener('gesturestart', onGestureStart);
    overlay.addEventListener('gesturechange', onGestureChange);
    overlay.addEventListener('gestureend', onGestureEnd);
    return () => {
      overlay.removeEventListener('wheel', onWheel);
      overlay.removeEventListener('gesturestart', onGestureStart);
      overlay.removeEventListener('gesturechange', onGestureChange);
      overlay.removeEventListener('gestureend', onGestureEnd);
    };
  }, []);

  const imageSize = (img: HTMLImageElement): Size => ({ width: img.offsetWidth, height: img.offsetHeight });

  const onPointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    if (!zoomed || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLImageElement>) => {
    const last = dragRef.current;
    if (!last) return;
    dragRef.current = { x: e.clientX, y: e.clientY };
    const size = imageSize(e.currentTarget);
    setZoom(z => panBy(z, e.clientX - last.x, e.clientY - last.y, size));
  };
  const onPointerUp = () => { dragRef.current = null; };

  const onDoubleClick = (e: React.MouseEvent<HTMLImageElement>) => {
    e.stopPropagation();
    if (zoomed) {
      setZoom(LIGHTBOX_ZOOM_RESET);
      return;
    }
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;
    const anchor = { x: e.clientX - (rect.left + rect.width / 2), y: e.clientY - (rect.top + rect.height / 2) };
    const size = imageSize(e.currentTarget);
    setZoom(z => zoomAt(z, DOUBLE_CLICK_ZOOM, anchor, size));
  };

  return createPortal(
    <div ref={overlayRef} className="cover-lightbox-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={alt}>
      <button className="cover-lightbox-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
      <img
        ref={imgRef}
        className={`cover-lightbox-img${zoomed ? ' cover-lightbox-img--zoomed' : ''}`}
        src={src}
        alt={alt}
        draggable={false}
        style={zoomed ? { transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` } : undefined}
        onClick={e => e.stopPropagation()}
        onDoubleClick={onDoubleClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>,
    document.body
  );
}
