import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blurredCover, boxBlurRgba, peekBlurredCover, resetBlurredCoverCache } from '@/lib/dom/blurredCover';

const loaded: Array<{ src: string; crossOrigin: string | null }> = [];

class FakeImage {
  crossOrigin: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(value: string) {
    loaded.push({ src: value, crossOrigin: this.crossOrigin });
    setTimeout(() => (value.includes('missing') ? this.onerror?.() : this.onload?.()), 0);
  }
}

describe('blurredCover', () => {
  const drawImage = vi.fn();
  const getImageData = vi.fn();
  const putImageData = vi.fn();

  beforeEach(() => {
    resetBlurredCoverCache();
    loaded.length = 0;
    drawImage.mockClear();
    putImageData.mockClear();
    getImageData.mockReset().mockImplementation((_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
    }));
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      { drawImage, getImageData, putImageData } as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,tiny');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('draws the cover into a 32 px canvas, blurs it there, loaded CORS-clean, once per source', async () => {
    const src = 'http://asset.localhost/cover/512.webp';
    const [a, b] = await Promise.all([blurredCover(src), blurredCover(src)]);

    expect(a).toBe('data:image/png;base64,tiny');
    expect(b).toBe(a);
    expect(loaded).toEqual([{ src, crossOrigin: 'anonymous' }]);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 32, 32);
    expect(getImageData).toHaveBeenCalledWith(0, 0, 32, 32);
    expect(putImageData).toHaveBeenCalledWith(getImageData.mock.results[0]?.value, 0, 0);
    expect(peekBlurredCover(src)).toBe(a);
  });

  it('does not ask for CORS on data and blob URLs', async () => {
    await blurredCover('data:image/png;base64,abc');
    expect(loaded[0]?.crossOrigin).toBeNull();
  });

  it('gives up (and remembers it) when the pixels cannot be read', async () => {
    getImageData.mockImplementation(() => { throw new DOMException('tainted', 'SecurityError'); });
    const src = 'https://elsewhere.test/cover.jpg';

    expect(await blurredCover(src)).toBeNull();
    expect(peekBlurredCover(src)).toBeNull();
    await blurredCover(src);
    expect(loaded).toHaveLength(1);
  });

  it('gives up when the image does not load', async () => {
    expect(await blurredCover('http://asset.localhost/missing.webp')).toBeNull();
  });

  it('reports an unknown source as not computed yet', () => {
    expect(peekBlurredCover('http://asset.localhost/never.webp')).toBeUndefined();
  });
});

describe('boxBlurRgba', () => {
  it('spreads a pixel over its neighbours and clamps at the edges', () => {
    // 5 x 1 row, opaque black with one red pixel in the middle.
    const px = new Uint8ClampedArray(5 * 4);
    for (let i = 0; i < 5; i++) px[i * 4 + 3] = 255;
    px[2 * 4] = 255;

    boxBlurRgba(px, 5, 1, 1, 1);

    expect(Array.from({ length: 5 }, (_, i) => px[i * 4])).toEqual([0, 85, 85, 85, 0]);
    expect(Array.from({ length: 5 }, (_, i) => px[i * 4 + 3])).toEqual([255, 255, 255, 255, 255]);
  });

  it('leaves a flat image flat', () => {
    const px = new Uint8ClampedArray(3 * 3 * 4).fill(120);
    boxBlurRgba(px, 3, 3, 2, 3);
    expect(px.every(v => v === 120)).toBe(true);
  });
});
