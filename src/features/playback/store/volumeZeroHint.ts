import i18n from '@/lib/i18n';
import { showToast } from '@/lib/dom/toast';

/** Several quick starts (clicking through tracks) get one hint, not a stack. */
const REPEAT_AFTER_MS = 10_000;
let lastShownAt = Number.NEGATIVE_INFINITY;

/**
 * The user started playback while the app volume is 0, so nothing will be
 * heard — say so. Only for starts the user made; the queue moving on by itself
 * stays quiet, since someone who muted on purpose does not need a hint per song.
 * Takes the volume rather than reading the player store, which imports the
 * actions that call this.
 */
export function hintIfVolumeIsZero(volume: number): void {
  if (volume > 0) return;
  const now = Date.now();
  if (now - lastShownAt < REPEAT_AFTER_MS) return;
  lastShownAt = now;
  showToast(i18n.t('player.volumeZeroHint'), 5000, 'warning');
}

/** Test-only reset. */
export function _resetVolumeZeroHintForTest(): void {
  lastShownAt = Number.NEGATIVE_INFINITY;
}
