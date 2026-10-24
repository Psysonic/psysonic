import { describe, expect, it } from 'vitest';
import {
  clampPan,
  LIGHTBOX_MAX_SCALE,
  LIGHTBOX_ZOOM_RESET,
  panBy,
  wheelZoomFactor,
  zoomAt,
} from './coverLightboxZoom';

const image = { width: 400, height: 400 };

describe('zoomAt', () => {
  it('zooms around the centre without moving it', () => {
    expect(zoomAt(LIGHTBOX_ZOOM_RESET, 2, { x: 0, y: 0 }, image)).toEqual({ scale: 2, x: 0, y: 0 });
  });

  it('keeps the point under the pointer in place', () => {
    const anchor = { x: 100, y: -50 };
    const z = zoomAt(LIGHTBOX_ZOOM_RESET, 2, anchor, image);
    // Unzoomed, the image point under the anchor is the anchor itself.
    expect((anchor.x - z.x) / z.scale).toBeCloseTo(anchor.x);
    expect((anchor.y - z.y) / z.scale).toBeCloseTo(anchor.y);
  });

  it('never zooms out past the fitted size and resets the pan there', () => {
    const zoomed = { scale: 2, x: 80, y: -40 };
    expect(zoomAt(zoomed, 0.1, { x: 10, y: 10 }, image)).toEqual(LIGHTBOX_ZOOM_RESET);
  });

  it('caps the zoom level', () => {
    expect(zoomAt(LIGHTBOX_ZOOM_RESET, 100, { x: 0, y: 0 }, image).scale).toBe(LIGHTBOX_MAX_SCALE);
  });
});

describe('panBy / clampPan', () => {
  it('does not pan an unzoomed image', () => {
    expect(panBy(LIGHTBOX_ZOOM_RESET, 50, 50, image)).toEqual(LIGHTBOX_ZOOM_RESET);
  });

  it('pans a zoomed image within its bounds', () => {
    expect(panBy({ scale: 2, x: 0, y: 0 }, 50, -30, image)).toEqual({ scale: 2, x: 50, y: -30 });
  });

  it('stops panning at the image edge', () => {
    // At 2× a 400 px image may shift at most 200 px either way.
    expect(clampPan({ scale: 2, x: 500, y: -500 }, image)).toEqual({ scale: 2, x: 200, y: -200 });
  });
});

describe('wheelZoomFactor', () => {
  it('zooms in when scrolling up and out when scrolling down', () => {
    expect(wheelZoomFactor(-10, 0)).toBeGreaterThan(1);
    expect(wheelZoomFactor(10, 0)).toBeLessThan(1);
  });

  it('caps a single mouse notch', () => {
    expect(wheelZoomFactor(-5, 1)).toBeCloseTo(Math.exp(0.5));
    expect(wheelZoomFactor(-1000, 0)).toBeCloseTo(Math.exp(0.5));
  });
});
