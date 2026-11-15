import { StrictMode } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/store/authStore';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { useLyricsAppearance } from './useLyricsAppearance';

function Surface({ visible = true, badge = false }: { visible?: boolean; badge?: boolean }) {
  const { appearanceRef, appearanceStyle, badgeRef, showSizeIndicator } = useLyricsAppearance();
  return visible ? <div ref={appearanceRef} style={appearanceStyle}>lyrics{badge && showSizeIndicator && <button ref={badgeRef}>100%</button>}</div> : null;
}

function wheel(node: Element, init: WheelEventInit = {}) {
  const event = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true, ...init });
  act(() => { node.dispatchEvent(event); });
  return event;
}

beforeEach(resetAuthStore);
afterEach(() => { vi.restoreAllMocks(); });

describe('shared lyrics wheel zoom', () => {
  it('keeps the viewport listener and its fine-wheel accumulator when the badge is toggled off', () => {
    const { getByRole, getByText, queryByRole } = render(<Surface badge />);
    const viewport = getByText('lyrics');
    const old = getByRole('button');
    wheel(viewport, { ctrlKey: true, deltaY: -75 });
    act(() => useAuthStore.getState().setLyricsSizeIndicatorEnabled(false));
    expect(queryByRole('button')).toBeNull();
    expect(getByText('lyrics')).toBe(viewport);
    expect(wheel(old).defaultPrevented).toBe(false);
    expect(wheel(viewport, { ctrlKey: true, deltaY: -25 }).defaultPrevented).toBe(true);
    expect(useAuthStore.getState().lyricsScale).toBe(1.1);
    act(() => useAuthStore.getState().setLyricsSizeIndicatorEnabled(true));
    expect(wheel(getByRole('button')).defaultPrevented).toBe(true);
    expect(useAuthStore.getState().lyricsScale).toBe(1.2);
  });

  it('uses the same fine-distance accumulator for plain badge wheel without parent double handling', () => {
    const { getByRole, getByText } = render(<Surface badge />);
    const badge = getByRole('button');
    const parent = getByText('lyrics');
    const bubbles = vi.fn();
    parent.addEventListener('wheel', bubbles);
    const writes = vi.fn();
    const unsubscribe = useAuthStore.subscribe(writes);
    try {
      for (let i = 0; i < 10; i++) expect(wheel(badge, { deltaY: -0.1 }).defaultPrevented).toBe(true);
      expect(writes).not.toHaveBeenCalled();
      wheel(badge, { deltaY: -99 });
      expect(useAuthStore.getState().lyricsScale).toBe(1.1);
      expect(writes).toHaveBeenCalledTimes(1);
      wheel(badge, { ctrlKey: true });
      expect(useAuthStore.getState().lyricsScale).toBe(1.2);
      expect(writes).toHaveBeenCalledTimes(2);
      expect(bubbles).not.toHaveBeenCalled();
      expect(wheel(parent).defaultPrevented).toBe(false);
      expect(writes).toHaveBeenCalledTimes(2);
      expect(wheel(badge, { deltaY: 0 }).defaultPrevented).toBe(false);
      expect(wheel(badge, { deltaX: 200 }).defaultPrevented).toBe(false);
    } finally { unsubscribe(); }
  });

  it('normalizes badge line/page units using the lyrics viewport and clears distance on reversal/idle', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { getByRole, getByText } = render(<Surface badge />);
    const badge = getByRole('button');
    Object.defineProperty(getByText('lyrics'), 'clientHeight', { value: 400 });
    wheel(badge, { deltaMode: 1, deltaY: -6.25 });
    expect(useAuthStore.getState().lyricsScale).toBe(1.1);
    wheel(badge, { deltaMode: 2, deltaY: -0.25 });
    expect(useAuthStore.getState().lyricsScale).toBe(1.2);
    wheel(badge, { deltaY: -75 });
    wheel(badge, { deltaY: 75 });
    expect(useAuthStore.getState().lyricsScale).toBe(1.2);
    now.mockReturnValue(1000);
    wheel(badge, { deltaY: 25 });
    expect(useAuthStore.getState().lyricsScale).toBe(1.2);
    now.mockReturnValue(1100);
    wheel(badge, { deltaY: 75 });
    expect(useAuthStore.getState().lyricsScale).toBe(1.1);
  });

  it('cancels plain badge wheel at limits without writes and cleans old badge refs in StrictMode', () => {
    const { getByRole, rerender, unmount } = render(<StrictMode><Surface badge /></StrictMode>);
    const old = getByRole('button');
    act(() => useAuthStore.setState({ lyricsScale: 2 }));
    const writes = vi.fn();
    const unsubscribe = useAuthStore.subscribe(writes);
    try {
      expect(wheel(old).defaultPrevented).toBe(true);
      expect(writes).not.toHaveBeenCalled();
      act(() => useAuthStore.setState({ lyricsScale: 0.5 }));
      writes.mockClear();
      expect(wheel(old, { deltaY: 100 }).defaultPrevented).toBe(true);
      expect(writes).not.toHaveBeenCalled();
      wheel(old, { deltaY: -75 });
      rerender(<StrictMode><Surface badge visible={false} /></StrictMode>);
      expect(wheel(old).defaultPrevented).toBe(false);
      rerender(<StrictMode><Surface badge /></StrictMode>);
      const fresh = getByRole('button');
      wheel(fresh, { deltaY: -25 });
      expect(useAuthStore.getState().lyricsScale).toBe(0.5);
      unmount();
      expect(wheel(fresh).defaultPrevented).toBe(false);
    } finally { unsubscribe(); }
  });
  it('leaves ordinary/horizontal/zero wheel alone and scopes modified wheel to lyrics', () => {
    const { getByText } = render(<Surface />);
    const node = getByText('lyrics');
    expect(wheel(node).defaultPrevented).toBe(false);
    expect(wheel(node, { ctrlKey: true, deltaX: 200 }).defaultPrevented).toBe(false);
    expect(wheel(node, { ctrlKey: true, deltaY: 0 }).defaultPrevented).toBe(false);
    expect(wheel(document.body, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(useAuthStore.getState().lyricsScale).toBe(1);
    expect(wheel(node, { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(useAuthStore.getState().lyricsScale).toBe(1.1);
    expect(node.style.getPropertyValue('--lyrics-scale')).toBe('1.1');
  });

  it.each([[0, 100], [1, 6.25], [2, 0.25]])('normalizes deltaMode %s to pixels before stepping, including Meta wheel', (deltaMode, deltaY) => {
    const { getByText } = render(<Surface />);
    const node = getByText('lyrics');
    Object.defineProperty(node, 'clientHeight', { value: 400 });
    expect(wheel(node, { metaKey: true, deltaY, deltaMode }).defaultPrevented).toBe(true);
    expect(useAuthStore.getState().lyricsScale).toBe(0.9);
  });

  it('cancels fine wheel streams without writing until 100 pixels accumulate', () => {
    const { getByText } = render(<Surface />);
    const node = getByText('lyrics');
    const writes = vi.fn();
    const unsubscribe = useAuthStore.subscribe(writes);
    try {
      for (let i = 0; i < 10; i++) {
        expect(wheel(node, { ctrlKey: true, deltaY: -0.1 }).defaultPrevented).toBe(true);
      }
      expect(useAuthStore.getState().lyricsScale).toBe(1);
      expect(writes).not.toHaveBeenCalled();
      wheel(node, { ctrlKey: true, deltaY: -99 });
      expect(useAuthStore.getState().lyricsScale).toBe(1.1);
      expect(writes).toHaveBeenCalledTimes(1);
    } finally { unsubscribe(); }
  });

  it('retains only sub-step distance, resets on reversal and ordinary wheel interruptions', () => {
    const { getByText } = render(<Surface />);
    const node = getByText('lyrics');
    wheel(node, { ctrlKey: true, deltaY: -75 });
    wheel(node, { ctrlKey: true, deltaY: -50 });
    expect(useAuthStore.getState().lyricsScale).toBe(1.1);
    wheel(node, { ctrlKey: true, deltaY: -75 });
    expect(useAuthStore.getState().lyricsScale).toBe(1.2);
    wheel(node, { ctrlKey: true, deltaY: -75 });
    wheel(node, { ctrlKey: true, deltaY: 75 });
    expect(useAuthStore.getState().lyricsScale).toBe(1.2);
    wheel(node, { ctrlKey: true, deltaY: 25 });
    expect(useAuthStore.getState().lyricsScale).toBe(1.1);
    wheel(node, { ctrlKey: true, deltaY: -75 });
    wheel(node); // An unmodified wheel event ends the zoom gesture.
    wheel(node, { ctrlKey: true, deltaY: -25 });
    expect(useAuthStore.getState().lyricsScale).toBe(1.1);
  });

  it('drops partial distance after idle time, external settings changes and conditional remount', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { getByText, rerender } = render(<Surface />);
    let node = getByText('lyrics');
    wheel(node, { ctrlKey: true, deltaY: -75 });
    now.mockReturnValue(1000);
    wheel(node, { ctrlKey: true, deltaY: -25 });
    expect(useAuthStore.getState().lyricsScale).toBe(1);
    act(() => useAuthStore.getState().setLyricsScale(1.5));
    wheel(node, { ctrlKey: true, deltaY: -75 });
    expect(useAuthStore.getState().lyricsScale).toBe(1.5);
    rerender(<Surface visible={false} />);
    rerender(<Surface />);
    node = getByText('lyrics');
    wheel(node, { ctrlKey: true, deltaY: -25 });
    expect(useAuthStore.getState().lyricsScale).toBe(1.5);
  });

  it('does not write unchanged limits or carry excess distance into a reversed gesture', () => {
    const { getByText } = render(<Surface />);
    const node = getByText('lyrics');
    act(() => useAuthStore.getState().setLyricsScale(2));
    const writes = vi.fn();
    const unsubscribe = useAuthStore.subscribe(writes);
    try {
      expect(wheel(node, { ctrlKey: true, deltaY: -2500 }).defaultPrevented).toBe(true);
      expect(writes).not.toHaveBeenCalled();
      wheel(node, { ctrlKey: true, deltaY: 50 });
      expect(useAuthStore.getState().lyricsScale).toBe(2);
      expect(writes).not.toHaveBeenCalled();
      wheel(node, { ctrlKey: true, deltaY: 50 });
      expect(useAuthStore.getState().lyricsScale).toBe(1.9);
      expect(writes).toHaveBeenCalledTimes(1);
      wheel(node, { ctrlKey: true, deltaY: 10000 });
      expect(useAuthStore.getState().lyricsScale).toBe(0.5);
      writes.mockClear();
      expect(wheel(node, { ctrlKey: true, deltaY: 100 }).defaultPrevented).toBe(true);
      expect(writes).not.toHaveBeenCalled();
      wheel(node, { ctrlKey: true, deltaY: -50 });
      expect(useAuthStore.getState().lyricsScale).toBe(0.5);
      wheel(node, { ctrlKey: true, deltaY: -50 });
      expect(useAuthStore.getState().lyricsScale).toBe(0.6);
      expect(writes).toHaveBeenCalledTimes(1);
    } finally { unsubscribe(); }
  });

  it('cancels browser zoom at both limits, including noncancelable events without throwing', () => {
    const { getByText } = render(<Surface />);
    const node = getByText('lyrics');
    act(() => useAuthStore.getState().setLyricsScale(2));
    expect(wheel(node, { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(useAuthStore.getState().lyricsScale).toBe(2);
    act(() => useAuthStore.getState().setLyricsScale(0.5));
    expect(wheel(node, { ctrlKey: true, deltaY: 100 }).defaultPrevented).toBe(true);
    expect(useAuthStore.getState().lyricsScale).toBe(0.5);
    expect(() => wheel(node, { ctrlKey: true, cancelable: false })).not.toThrow();
  });

  it('attaches nonpassively after conditional mount and cleans old/unmounted nodes in StrictMode', () => {
    const add = vi.spyOn(HTMLElement.prototype, 'addEventListener');
    const { getByText, rerender, unmount } = render(<StrictMode><Surface visible={false} /></StrictMode>);
    rerender(<StrictMode><Surface /></StrictMode>);
    const old = getByText('lyrics');
    expect(add).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });
    wheel(old, { ctrlKey: true });
    expect(useAuthStore.getState().lyricsScale).toBe(1.1);
    rerender(<StrictMode><Surface visible={false} /></StrictMode>);
    expect(wheel(old, { ctrlKey: true }).defaultPrevented).toBe(false);
    rerender(<StrictMode><Surface /></StrictMode>);
    const fresh = getByText('lyrics');
    wheel(fresh, { ctrlKey: true });
    expect(useAuthStore.getState().lyricsScale).toBe(1.2);
    unmount();
    expect(wheel(fresh, { ctrlKey: true }).defaultPrevented).toBe(false);
    add.mockRestore();
  });
});
