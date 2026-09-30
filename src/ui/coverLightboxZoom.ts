/**
 * Zoom / pan math for the cover lightbox. The image is drawn with
 * `translate(x, y) scale(scale)` around its own centre, which sits at the
 * centre of the overlay.
 */

export const LIGHTBOX_MIN_SCALE = 1;
export const LIGHTBOX_MAX_SCALE = 8;

export interface LightboxZoom {
  scale: number;
  x: number;
  y: number;
}

export const LIGHTBOX_ZOOM_RESET: LightboxZoom = { scale: 1, x: 0, y: 0 };

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Keep the zoomed image covering its own unzoomed box, so it cannot be lost off-screen. */
export function clampPan(zoom: LightboxZoom, image: Size): LightboxZoom {
  if (zoom.scale <= LIGHTBOX_MIN_SCALE) return LIGHTBOX_ZOOM_RESET;
  const maxX = ((zoom.scale - 1) * image.width) / 2;
  const maxY = ((zoom.scale - 1) * image.height) / 2;
  return {
    scale: zoom.scale,
    x: Math.min(maxX, Math.max(-maxX, zoom.x)),
    y: Math.min(maxY, Math.max(-maxY, zoom.y)),
  };
}

/**
 * Scale by `factor`, keeping the image point under `anchor` (relative to the
 * overlay centre) where it is.
 */
export function zoomAt(zoom: LightboxZoom, factor: number, anchor: Point, image: Size): LightboxZoom {
  const scale = Math.min(LIGHTBOX_MAX_SCALE, Math.max(LIGHTBOX_MIN_SCALE, zoom.scale * factor));
  const ratio = scale / zoom.scale;
  return clampPan({
    scale,
    x: anchor.x - (anchor.x - zoom.x) * ratio,
    y: anchor.y - (anchor.y - zoom.y) * ratio,
  }, image);
}

export function panBy(zoom: LightboxZoom, dx: number, dy: number, image: Size): LightboxZoom {
  return clampPan({ scale: zoom.scale, x: zoom.x + dx, y: zoom.y + dy }, image);
}

/**
 * Zoom factor for one Ctrl/⌘ + wheel event. Touchpad pinches arrive as small
 * pixel deltas, mouse wheels as large notches; both map onto the same smooth
 * curve, with one step capped at ~1.65× so a mouse notch does not jump.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const clamped = Math.max(-50, Math.min(50, px));
  return Math.exp(-clamped / 100);
}
