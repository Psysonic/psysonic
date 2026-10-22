import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const playbackReportStopped = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('@/features/playback/store/playbackReportSession', () => ({
  playbackReportStopped,
}));

import { usePrivateModeStore } from '@/features/privateMode';
import { setupPrivateModePresence } from './privateModePresence';

let stop: (() => void) | null = null;

beforeEach(() => {
  usePrivateModeStore.setState({ active: false });
  playbackReportStopped.mockClear();
  stop = setupPrivateModePresence();
});

afterEach(() => {
  stop?.();
  stop = null;
});

describe('setupPrivateModePresence', () => {
  it('withdraws the live now-playing entry when private mode turns on', () => {
    usePrivateModeStore.getState().setActive(true);
    expect(playbackReportStopped).toHaveBeenCalledTimes(1);
  });

  it('does nothing when private mode turns off or is set to its current value', () => {
    usePrivateModeStore.getState().setActive(false);
    usePrivateModeStore.getState().setActive(true);
    usePrivateModeStore.getState().setActive(true);
    usePrivateModeStore.getState().setActive(false);
    expect(playbackReportStopped).toHaveBeenCalledTimes(1);
  });

  it('stops listening after cleanup', () => {
    stop?.();
    stop = null;
    usePrivateModeStore.getState().setActive(true);
    expect(playbackReportStopped).not.toHaveBeenCalled();
  });
});
