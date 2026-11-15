export const LYRICS_SCALE_DEFAULT = 1;
export const LYRICS_SCALE_MIN = 0.5;
export const LYRICS_SCALE_MAX = 2;
export const LYRICS_SCALE_STEP = 0.1;

export type LyricsZoomAction = 'increase' | 'decrease' | 'reset';

export function lyricsScaleForAction(scale: number, action: LyricsZoomAction): number {
  return normalizeLyricsScale(action === 'reset' ? LYRICS_SCALE_DEFAULT : scale + (action === 'increase' ? 1 : -1) * LYRICS_SCALE_STEP);
}

/** Prefer the layout-aware key; physical fallbacks are limited to the numpad. */
export function lyricsZoomAction(event: KeyboardEvent): LyricsZoomAction | null {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey ||
      event.getModifierState('AltGraph') || (!event.ctrlKey && !event.metaKey) || (event.ctrlKey && event.metaKey)) return null;
  if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') return 'increase';
  if (event.shiftKey) return null;
  if (event.key === '-' || event.code === 'NumpadSubtract') return 'decrease';
  if (event.key === '0' || event.code === 'Numpad0') return 'reset';
  return null;
}

/** Shared by settings writes, persisted-state repair and wheel zoom. */
export function normalizeLyricsScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return LYRICS_SCALE_DEFAULT;
  return Math.round(Math.max(LYRICS_SCALE_MIN, Math.min(LYRICS_SCALE_MAX, value)) * 10) / 10;
}

export function isLyricsZoomWheel(event: Pick<WheelEvent, 'ctrlKey' | 'metaKey' | 'deltaY' | 'deltaX'>): boolean {
  return (event.ctrlKey || event.metaKey) && Number.isFinite(event.deltaY) &&
    event.deltaY !== 0 && Math.abs(event.deltaY) > Math.abs(event.deltaX);
}

const WHEEL_STEP_PX = 100;
const WHEEL_IDLE_MS = 400;

/** Shared distance accumulator for modified text-wheel and plain badge-wheel.
 * Callers supply state/I/O; this module stays independent of stores and React.
 */
export function createLyricsZoomWheelHandler({ getScale, setScale, pageHeight, requireModifier = true }: {
  getScale: () => number;
  setScale: (scale: number) => void;
  pageHeight: () => number;
  requireModifier?: boolean;
}) {
  let distance = 0;
  let direction = 0;
  let lastAt = 0;
  let lastScale = getScale();
  return (event: WheelEvent) => {
    const vertical = Number.isFinite(event.deltaY) && event.deltaY !== 0 && Math.abs(event.deltaY) > Math.abs(event.deltaX);
    if (event.defaultPrevented || !vertical || (requireModifier && !isLyricsZoomWheel(event))) {
      distance = 0;
      direction = 0;
      return;
    }
    // Also below the threshold and at bounds; stop parent text-wheel handling.
    event.preventDefault();
    event.stopPropagation();
    const scale = getScale();
    const nextDirection = Math.sign(event.deltaY);
    const now = performance.now();
    if (direction !== nextDirection || now - lastAt > WHEEL_IDLE_MS || lastScale !== scale) distance = 0;
    direction = nextDirection;
    lastAt = now;
    lastScale = scale;
    if ((direction < 0 && scale >= LYRICS_SCALE_MAX) || (direction > 0 && scale <= LYRICS_SCALE_MIN)) {
      distance = 0;
      return;
    }
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight() : 1;
    const rangeSteps = (LYRICS_SCALE_MAX - LYRICS_SCALE_MIN) / LYRICS_SCALE_STEP;
    distance += direction * Math.min(Math.abs(event.deltaY) * unit, WHEEL_STEP_PX * rangeSteps);
    const steps = Math.floor((Math.abs(distance) + 1e-6) / WHEEL_STEP_PX);
    if (!steps) return;
    const next = normalizeLyricsScale(scale - direction * steps * LYRICS_SCALE_STEP);
    distance -= direction * steps * WHEEL_STEP_PX;
    if (next === LYRICS_SCALE_MIN || next === LYRICS_SCALE_MAX) distance = 0;
    if (next !== scale) { lastScale = next; setScale(next); }
  };
}
