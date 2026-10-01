import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isMinimized: vi.fn(async () => false),
  windowHidden: false,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ isMinimized: mocks.isMinimized }),
}));
vi.mock('@/lib/hooks/useWindowVisibility', () => ({
  useWindowVisibility: () => mocks.windowHidden,
}));

import { useFsAutoOpen } from './useFsAutoOpen';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { usePreviewStore } from '@/features/playback/store/previewStore';
import { useAuthStore } from '@/store/authStore';
import { resetAllStores } from '@/test/helpers/storeReset';
import { makeTrack } from '@/test/helpers/factories';

const MINUTE = 60_000;

const isOpen = () => usePlayerStore.getState().isFullscreenOpen;

function startPlaying(): void {
  usePlayerStore.setState({ isPlaying: true, currentTrack: makeTrack(), currentRadio: null });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function moveMouse(x: number, y: number): void {
  act(() => {
    window.dispatchEvent(new MouseEvent('mousemove', { screenX: x, screenY: y }));
  });
}

async function autoOpen(): Promise<void> {
  startPlaying();
  renderHook(() => useFsAutoOpen());
  await advance(2 * MINUTE);
  expect(isOpen()).toBe(true);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetAllStores();
  mocks.isMinimized.mockReset().mockResolvedValue(false);
  mocks.windowHidden = false;
  useAuthStore.setState({ fullscreenAutoOpenMinutes: 2 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useFsAutoOpen — opening', () => {
  it('opens the player once the configured minutes pass without input while a track plays', async () => {
    startPlaying();
    renderHook(() => useFsAutoOpen());

    await advance(2 * MINUTE - 1000);
    expect(isOpen()).toBe(false);
    await advance(1000);
    expect(isOpen()).toBe(true);
  });

  it('never opens when the setting is off', async () => {
    useAuthStore.setState({ fullscreenAutoOpenMinutes: 0 });
    startPlaying();
    renderHook(() => useFsAutoOpen());

    await advance(60 * MINUTE);
    expect(isOpen()).toBe(false);
  });

  it('restarts the countdown on input', async () => {
    startPlaying();
    renderHook(() => useFsAutoOpen());

    await advance(1.5 * MINUTE);
    moveMouse(10, 10);
    await advance(MINUTE);
    expect(isOpen()).toBe(false);
    await advance(MINUTE);
    expect(isOpen()).toBe(true);
  });

  it('keeps counting through a play-state flicker between tracks', async () => {
    startPlaying();
    renderHook(() => useFsAutoOpen());

    await advance(1.5 * MINUTE);
    act(() => usePlayerStore.setState({ isPlaying: false }));
    act(() => usePlayerStore.setState({ isPlaying: true }));
    await advance(0.5 * MINUTE);
    expect(isOpen()).toBe(true);
  });

  it.each([
    ['paused', () => usePlayerStore.setState({ isPlaying: false })],
    ['playing the radio', () => usePlayerStore.setState({ currentRadio: { id: 'r1', name: 'Station', streamUrl: 'https://radio.test/stream' } })],
    ['previewing a track', () => usePreviewStore.setState({ previewingId: 'preview-1' })],
    ['the window is hidden', () => { mocks.windowHidden = true; }],
  ])('does not open while %s', async (_label, arrange) => {
    startPlaying();
    arrange();
    renderHook(() => useFsAutoOpen());

    await advance(10 * MINUTE);
    expect(isOpen()).toBe(false);
  });

  it('waits while the window is minimized and opens once it is back', async () => {
    mocks.isMinimized.mockResolvedValue(true);
    startPlaying();
    renderHook(() => useFsAutoOpen());

    await advance(5 * MINUTE);
    expect(isOpen()).toBe(false);
    mocks.isMinimized.mockResolvedValue(false);
    await advance(30_000);
    expect(isOpen()).toBe(true);
  });
});

describe('useFsAutoOpen — closing an auto-opened player', () => {
  it('closes on pointer travel but not on a mousemove at the resting position', async () => {
    await autoOpen();

    moveMouse(100, 100);
    moveMouse(100, 100);
    expect(isOpen()).toBe(true);
    moveMouse(120, 100);
    expect(isOpen()).toBe(false);
  });

  it('consumes the waking key so no other handler sees it', async () => {
    await autoOpen();
    const onKey = vi.fn();
    window.addEventListener('keydown', onKey);

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    window.removeEventListener('keydown', onKey);

    expect(onKey).not.toHaveBeenCalled();
    expect(isOpen()).toBe(false);
  });

  it('consumes the waking press and the click that ends it', async () => {
    await autoOpen();
    const button = document.createElement('button');
    document.body.appendChild(button);
    const onClick = vi.fn();
    button.addEventListener('click', onClick);

    act(() => {
      button.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(isOpen()).toBe(false);
    expect(onClick).not.toHaveBeenCalled();

    await advance(1000);
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onClick).toHaveBeenCalledTimes(1);
    button.remove();
  });

  it('opens again after the next idle stretch', async () => {
    await autoOpen();
    moveMouse(0, 0);
    moveMouse(50, 50);
    expect(isOpen()).toBe(false);

    await advance(2 * MINUTE);
    expect(isOpen()).toBe(true);
  });

  it('leaves a player opened by hand alone', async () => {
    startPlaying();
    renderHook(() => useFsAutoOpen());
    act(() => usePlayerStore.getState().toggleFullscreen());

    moveMouse(0, 0);
    moveMouse(300, 300);
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    });
    expect(isOpen()).toBe(true);
  });
});
