import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const authState = {
    useCustomTitlebar: true,
    linuxWebkitKineticScroll: true,
    linuxWaylandTextRenderProfile: 'default',
    loggingMode: 'normal',
  };
  return {
    authState,
    isTilingWmCmd: vi.fn(async () => true),
    setWindowDecorations: vi.fn(async () => true),
    windowLifecycleGeneration: vi.fn(async () => 3),
  };
});

vi.mock('@/lib/util/platform', () => ({
  IS_LINUX: false,
  IS_MACOS: false,
  IS_WINDOWS: true,
}));

vi.mock('@/store/authStore', () => {
  const useAuthStore = Object.assign(
    (selector: (state: typeof mocks.authState) => unknown) => selector(mocks.authState),
    {
      getState: () => mocks.authState,
      persist: {
        hasHydrated: () => true,
        onFinishHydration: () => () => {},
      },
    },
  );
  return { useAuthStore };
});

vi.mock('@/lib/api/platformShell', () => ({
  isTilingWmCmd: mocks.isTilingWmCmd,
  linuxWaylandTextRenderSettingsAvailable: vi.fn(async () => false),
  noCompositingMode: vi.fn(async () => false),
  setLinuxWaylandTextRenderProfile: vi.fn(async () => undefined),
  setLinuxWebkitSmoothScrolling: vi.fn(async () => undefined),
  setLoggingMode: vi.fn(async () => undefined),
  setWindowDecorations: mocks.setWindowDecorations,
  windowLifecycleGeneration: mocks.windowLifecycleGeneration,
}));

import { usePlatformShellSetup } from './usePlatformShellSetup';

describe('usePlatformShellSetup on Windows', () => {
  beforeEach(() => {
    delete window.__psyIsTilingWm;
    delete window.__psyLifecycleGeneration;
    mocks.authState.useCustomTitlebar = true;
    mocks.isTilingWmCmd.mockClear();
    mocks.setWindowDecorations.mockReset().mockResolvedValue(true);
    mocks.windowLifecycleGeneration.mockReset().mockResolvedValue(3);
  });

  it('drops native decorations and mounts the custom titlebar when enabled', async () => {
    const { result } = renderHook(() => usePlatformShellSetup());

    await waitFor(() => expect(result.current.customTitlebarActive).toBe(true));
    await waitFor(() => expect(mocks.setWindowDecorations).toHaveBeenCalledWith({
      enabled: false,
      generation: 3,
      transition: expect.any(Number),
    }));
    expect(result.current.isTilingWm).toBe(false);
    expect(mocks.isTilingWmCmd).not.toHaveBeenCalled();
  });

  it('keeps native decorations when the custom titlebar is off', async () => {
    mocks.authState.useCustomTitlebar = false;

    const { result } = renderHook(() => usePlatformShellSetup());

    await waitFor(() => expect(mocks.setWindowDecorations).toHaveBeenCalledWith({
      enabled: true,
      generation: 3,
      transition: expect.any(Number),
    }));
    expect(result.current.customTitlebarActive).toBe(false);
  });

  it('restores native decorations when the custom-titlebar owner unmounts', async () => {
    const { result, unmount } = renderHook(() => usePlatformShellSetup());
    await waitFor(() => expect(result.current.customTitlebarActive).toBe(true));
    await waitFor(() => expect(mocks.setWindowDecorations).toHaveBeenCalledTimes(1));

    unmount();

    await waitFor(() => expect(mocks.setWindowDecorations).toHaveBeenLastCalledWith({
      enabled: true,
      generation: 3,
      transition: expect.any(Number),
    }));
  });
});
