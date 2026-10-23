import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<Point | null>(null);
  const [zoom, setZoom] = useState<LightboxZoom>(LIGHTBOX_ZOOM_RESET);
  const zoomed = zoom.scale > 1;

  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

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

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      // This modal has two focus targets; do not tab into the covered page.
      e.preventDefault();
      if (document.activeElement === closeRef.current) imgRef.current?.focus();
      else closeRef.current?.focus();
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey || !imgRef.current) return;
    const size = imageSize(imgRef.current);
    const pans: Record<string, Point> = {
      ArrowLeft: { x: 40, y: 0 }, ArrowRight: { x: -40, y: 0 },
      ArrowUp: { x: 0, y: 40 }, ArrowDown: { x: 0, y: -40 },
    };
    if (e.key === '+' || e.key === '=' || e.key === '-') {
      e.preventDefault();
      e.stopPropagation();
      setZoom(z => zoomAt(z, e.key === '-' ? 1 / 1.25 : 1.25, { x: 0, y: 0 }, size));
    } else if (e.key === '0') {
      e.preventDefault();
      e.stopPropagation();
      setZoom(LIGHTBOX_ZOOM_RESET);
    } else if (pans[e.key]) {
      e.preventDefault();
      e.stopPropagation();
      const { x, y } = pans[e.key];
      setZoom(z => panBy(z, x, y, size));
    }
  };

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
    <div ref={overlayRef} className="cover-lightbox-overlay" onClick={onClose} onKeyDown={onKeyDown} role="dialog" aria-modal="true" aria-label={alt}>
      <button ref={closeRef} className="cover-lightbox-close" onClick={onClose} aria-label={t('common.close')}><X size={20} /></button>
      <img
        ref={imgRef}
        className={`cover-lightbox-img${zoomed ? ' cover-lightbox-img--zoomed' : ''}`}
        src={src}
        alt={alt}
        tabIndex={0}
        aria-keyshortcuts="+ = - 0 ArrowLeft ArrowRight ArrowUp ArrowDown"
        draggable={false}
        style={zoomed ? { transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` } : undefined}
        onClick={e => e.stopPropagation()}
        onDoubleClick={onDoubleClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
      />
    </div>,
    document.body
  );
}
