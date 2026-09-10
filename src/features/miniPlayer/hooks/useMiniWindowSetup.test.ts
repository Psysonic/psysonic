import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const setMiniPlayerDecorations = vi.hoisted(() => vi.fn(async () => undefined));
const setMiniPlayerAlwaysOnTop = vi.hoisted(() => vi.fn(async () => undefined));
const resizeMiniPlayer = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@/lib/api/miniPlayer', () => ({
  setMiniPlayerDecorations,
  setMiniPlayerAlwaysOnTop,
  resizeMiniPlayer,
}));

vi.mock('@/lib/api/platformShell', () => ({
  setLinuxWebkitSmoothScrolling: vi.fn(async () => undefined),
}));

// The frame switch is Windows-only; the platform flags are read at module load.
vi.mock('@/lib/util/platform', () => ({
  IS_LINUX: false,
  IS_MACOS: false,
  IS_WINDOWS: true,
}));

import { useMiniWindowSetup } from './useMiniWindowSetup';
import { useAuthStore } from '@/store/authStore';

beforeEach(() => {
  setMiniPlayerDecorations.mockClear();
  useAuthStore.setState({ miniPlayerCustomTitlebar: false });
});

describe('useMiniWindowSetup — window frame', () => {
  it('keeps the native frame while the setting is off', () => {
    renderHook(() => useMiniWindowSetup(true, false));
    expect(setMiniPlayerDecorations).toHaveBeenCalledWith({ decorations: true });
  });

  it('drops the native frame when the setting is on', () => {
    useAuthStore.setState({ miniPlayerCustomTitlebar: true });
    renderHook(() => useMiniWindowSetup(true, false));
    expect(setMiniPlayerDecorations).toHaveBeenCalledWith({ decorations: false });
  });

  it('follows the setting while the window stays open', () => {
    renderHook(() => useMiniWindowSetup(true, false));
    setMiniPlayerDecorations.mockClear();

    // The main window writes the setting; the mini re-reads it from the shared
    // store rather than waiting for a restart.
    act(() => {
      useAuthStore.setState({ miniPlayerCustomTitlebar: true });
    });

    expect(setMiniPlayerDecorations).toHaveBeenCalledWith({ decorations: false });
  });
});
