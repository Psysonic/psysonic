import { beforeEach, describe, expect, it, vi } from 'vitest';

const showToast = vi.hoisted(() => vi.fn());
vi.mock('@/lib/dom/toast', () => ({ showToast }));

import { _resetVolumeZeroHintForTest, hintIfVolumeIsZero } from './volumeZeroHint';

beforeEach(() => {
  vi.useFakeTimers();
  showToast.mockClear();
  _resetVolumeZeroHintForTest();
});

describe('hintIfVolumeIsZero', () => {
  it('warns at volume 0 and stays quiet above it', () => {
    hintIfVolumeIsZero(0.01);
    expect(showToast).not.toHaveBeenCalled();
    hintIfVolumeIsZero(0);
    expect(showToast).toHaveBeenCalledWith('The volume is at 0 — turn it up to hear anything.', 5000, 'warning');
  });

  it('shows one hint for starts within ten seconds', () => {
    hintIfVolumeIsZero(0);
    vi.advanceTimersByTime(9_999);
    hintIfVolumeIsZero(0);
    expect(showToast).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    hintIfVolumeIsZero(0);
    expect(showToast).toHaveBeenCalledTimes(2);
  });
});
