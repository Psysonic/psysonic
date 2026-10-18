import { describe, expect, it, vi } from 'vitest';
import type { NavigateFunction } from 'react-router';
import { fireEvent, renderHook } from '@testing-library/react';
import { useKeybindingsStore } from '@/store/keybindingsStore';
import { useInAppKeybindings } from './useInAppKeybindings';

type App = { useKeybindingsStore: typeof useKeybindingsStore; useInAppKeybindings: typeof useInAppKeybindings };

// The shipped Settings chord is platform-dependent, and the shortcut registry
// reads the platform flag at module load — so the macOS case needs its own
// module graph. Plain jsdom already reports a non-mac platform.
async function loadMacApp(): Promise<App> {
  localStorage.clear();
  vi.resetModules();
  vi.doMock('@/lib/util/platform', () => ({ IS_MACOS: true, IS_LINUX: false, IS_WINDOWS: false }));
  const hooks = await import('./useInAppKeybindings');
  const bindings = await import('@/store/keybindingsStore');
  return { useKeybindingsStore: bindings.useKeybindingsStore, useInAppKeybindings: hooks.useInAppKeybindings };
}

async function loadDesktopApp(): Promise<App> {
  localStorage.clear();
  return { useKeybindingsStore, useInAppKeybindings };
}

const CASES = [
  {
    platform: 'macOS',
    load: loadMacApp,
    want: { code: 'Comma', metaKey: true },
    other: { code: 'Comma', ctrlKey: true },
  },
  {
    platform: 'Windows / Linux',
    load: loadDesktopApp,
    want: { code: 'Comma', ctrlKey: true },
    other: { code: 'Comma', metaKey: true },
  },
] as const;

for (const { platform, load, want, other } of CASES) {
  describe(`in-app keybindings (${platform})`, () => {
    it('opens settings on the shipped Settings chord', async () => {
      const navigate = vi.fn();
      const app = await load();
      app.useKeybindingsStore.getState().resetToDefaults();
      renderHook(() => app.useInAppKeybindings(navigate as NavigateFunction));

      fireEvent.keyDown(window, want);

      expect(navigate).toHaveBeenCalledWith('/settings');
    });

    it('ignores the chord belonging to the other platform', async () => {
      const navigate = vi.fn();
      const app = await load();
      app.useKeybindingsStore.getState().resetToDefaults();
      renderHook(() => app.useInAppKeybindings(navigate as NavigateFunction));

      fireEvent.keyDown(window, other);

      expect(navigate).not.toHaveBeenCalled();
    });

    it('stays silent once the user unbinds Settings', async () => {
      const navigate = vi.fn();
      const app = await load();
      app.useKeybindingsStore.getState().setBinding('open-settings', null);
      renderHook(() => app.useInAppKeybindings(navigate as NavigateFunction));

      fireEvent.keyDown(window, want);

      expect(navigate).not.toHaveBeenCalled();
    });
  });
}
