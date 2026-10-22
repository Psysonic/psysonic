/**
 * A blurred stand-in for an explicit cover without a CSS `filter`: the image is
 * drawn into a 32 px canvas once, box-blurred there, and the browser stretches
 * the result back up. One small draw per cover; a `filter: blur()` would give
 * every such element its own compositing layer — a full software repaint on
 * WebKitGTK without GPU compositing. Downscaling alone keeps shapes readable
 * and turns blocky on larger covers, hence the blur pass.
 *
 * Reading the pixels needs a CORS-clean image. Tauri's asset protocol answers
 * with `Access-Control-Allow-Origin` for the window origin, so disk covers load
 * with `crossOrigin = "anonymous"`. Anything that cannot be read resolves to
 * `null`, and the caller keeps the cover hidden instead of showing it sharp.
 */

const SIZE = 32;
const BLUR_RADIUS = 2;
/** Three box passes approximate a Gaussian. */
const BLUR_PASSES = 3;
const MAX_ENTRIES = 300;

const done = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

function remember(src: string, value: string | null): void {
  done.delete(src);
  done.set(src, value);
  if (done.size > MAX_ENTRIES) {
    const oldest = done.keys().next().value;
    if (oldest !== undefined) done.delete(oldest);
  }
}

function loadCorsImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('data:') && !src.startsWith('blob:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('cover load failed'));
    img.src = src;
  });
}

/** Separable box blur over RGBA pixels in place, edges clamped. */
export function boxBlurRgba(
  px: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  passes: number,
): void {
  const tmp = new Float32Array(px.length);
  const span = radius * 2 + 1;
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let k = -radius; k <= radius; k++) {
            const xi = Math.min(width - 1, Math.max(0, x + k));
            sum += px[(y * width + xi) * 4 + c];
          }
          tmp[(y * width + x) * 4 + c] = sum / span;
        }
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let k = -radius; k <= radius; k++) {
            const yi = Math.min(height - 1, Math.max(0, y + k));
            sum += tmp[(yi * width + x) * 4 + c];
          }
          px[(y * width + x) * 4 + c] = sum / span;
        }
      }
    }
  }
}

async function render(src: string): Promise<string | null> {
  try {
    const img = await loadCorsImage(src);
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    // Throws on a tainted canvas — the cover stays hidden then.
    const pixels = ctx.getImageData(0, 0, SIZE, SIZE);
    boxBlurRgba(pixels.data, SIZE, SIZE, BLUR_RADIUS, BLUR_PASSES);
    ctx.putImageData(pixels, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** The stand-in if it is already known: a data URL, `null` (unreadable) or `undefined` (not computed yet). */
export function peekBlurredCover(src: string): string | null | undefined {
  return done.has(src) ? done.get(src) ?? null : undefined;
}

export function blurredCover(src: string): Promise<string | null> {
  if (done.has(src)) return Promise.resolve(done.get(src) ?? null);
  const running = pending.get(src);
  if (running) return running;
  const job = render(src).then(value => {
    pending.delete(src);
    remember(src, value);
    return value;
  });
  pending.set(src, job);
  return job;
}

/** Test seam. */
export function resetBlurredCoverCache(): void {
  done.clear();
  pending.clear();
}
