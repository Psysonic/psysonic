import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showToast } from './toast';

const region = (politeness: 'polite' | 'assertive') =>
  document.querySelector<HTMLElement>(`[data-toast-live="${politeness}"]`);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('showToast for screen readers', () => {
  it('announces notices through a polite status region and hides the visual copy', () => {
    showToast('Added 3 songs', 4000, 'info');
    vi.advanceTimersByTime(100);

    const polite = region('polite');
    expect(polite).toHaveAttribute('role', 'status');
    expect(polite).toHaveAttribute('aria-live', 'polite');
    expect(polite).toHaveTextContent('Added 3 songs');
    expect(document.querySelector('.psysonic-toast')).toHaveAttribute('aria-hidden', 'true');
  });

  it('announces errors through an assertive alert region', () => {
    showToast('Could not reach the server', 4000, 'error');
    vi.advanceTimersByTime(100);

    const assertive = region('assertive');
    expect(assertive).toHaveAttribute('role', 'alert');
    expect(assertive).toHaveTextContent('Could not reach the server');
  });

  it('reuses one region and announces a repeated message again', () => {
    showToast('Volume is at 0', 4000, 'warning');
    vi.advanceTimersByTime(100);
    showToast('Volume is at 0', 4000, 'warning');

    expect(document.querySelectorAll('[data-toast-live="polite"]')).toHaveLength(1);
    // Cleared at once, filled again after the delay — the change is what a screen reader hears.
    expect(region('polite')).toHaveTextContent('');
    vi.advanceTimersByTime(100);
    expect(region('polite')).toHaveTextContent('Volume is at 0');
  });
});
