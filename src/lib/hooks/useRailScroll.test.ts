import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useRailScroll } from './useRailScroll';
import { latestResizeObserver } from '@/test/mocks/browser';

/**
 * jsdom does no layout, so the scroll box is described explicitly. The numbers
 * mirror a real Mainstage row: twelve 180px cards with 16px gaps is 2336px of
 * content, which fits inside a rail on a wide screen and overflows a narrow one.
 */
function railElement(scrollWidth: number, clientWidth: number, scrollLeft = 0) {
  const el = document.createElement('div');
  for (const [prop, value] of [
    ['scrollWidth', scrollWidth],
    ['clientWidth', clientWidth],
    ['scrollLeft', scrollLeft],
  ] as const) {
    Object.defineProperty(el, prop, { value, configurable: true, writable: true });
  }
  return el;
}

/** The hook measures inside `requestAnimationFrame`; a microtask is too early. */
async function settleFrame() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 32)); });
}

const FULL_ROW = 2336;
const WIDE_RAIL = 3500;
const NARROW_RAIL = 1200;

describe('useRailScroll', () => {
  it('pulls another page when the row does not fill its width', async () => {
    const el = railElement(FULL_ROW, WIDE_RAIL);
    const ref = { current: el };
    const onFillWidth = vi.fn().mockResolvedValue(undefined);

    renderHook(() => useRailScroll({
      scrollRef: ref,
      itemCount: 12,
      onFillWidth,
    }));

    await waitFor(() => expect(onFillWidth).toHaveBeenCalledTimes(1));
  });

  it('leaves an overflowing row alone', async () => {
    const el = railElement(5000, NARROW_RAIL);
    const ref = { current: el };
    const onFillWidth = vi.fn().mockResolvedValue(undefined);

    renderHook(() => useRailScroll({
      scrollRef: ref,
      itemCount: 12,
      onFillWidth,
    }));

    await settleFrame();
    expect(onFillWidth).not.toHaveBeenCalled();
  });

  it('stops asking once a round brings nothing new', async () => {
    const el = railElement(FULL_ROW, WIDE_RAIL);
    const ref = { current: el };
    const onFillWidth = vi.fn().mockResolvedValue(undefined);

    renderHook(() => useRailScroll({
      scrollRef: ref,
      itemCount: 12,
      onFillWidth,
    }));
    await waitFor(() => expect(onFillWidth).toHaveBeenCalledTimes(1));

    // The section had no more rows, so the count is unchanged. A resize must not
    // restart the paging.
    act(() => latestResizeObserver()?.emit());
    await settleFrame();
    expect(onFillWidth).toHaveBeenCalledTimes(1);
  });

  it('keeps paging while each round adds rows', async () => {
    const el = railElement(FULL_ROW, WIDE_RAIL);
    const ref = { current: el };
    const onFillWidth = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({ itemCount }) => useRailScroll({ scrollRef: ref, itemCount, onFillWidth }),
      { initialProps: { itemCount: 12 } },
    );
    await waitFor(() => expect(onFillWidth).toHaveBeenCalledTimes(1));

    rerender({ itemCount: 24 });
    await waitFor(() => expect(onFillWidth).toHaveBeenCalledTimes(2));
  });

  it('gives up after the fill budget instead of paging forever', async () => {
    const el = railElement(FULL_ROW, WIDE_RAIL);
    const ref = { current: el };
    const onFillWidth = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({ itemCount }) => useRailScroll({ scrollRef: ref, itemCount, onFillWidth }),
      { initialProps: { itemCount: 12 } },
    );

    for (const itemCount of [24, 36, 48, 60, 72]) {
      await settleFrame();
      rerender({ itemCount });
    }
    await settleFrame();

    expect(onFillWidth.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('disables the next arrow when everything already fits', async () => {
    const el = railElement(FULL_ROW, WIDE_RAIL);
    const ref = { current: el };

    const { result } = renderHook(() => useRailScroll({
      scrollRef: ref,
      itemCount: 12,
    }));

    await waitFor(() => expect(result.current.showRight).toBe(false));
    expect(result.current.showLeft).toBe(false);
  });

  it('re-arms the arrow when the rail itself gets narrower', async () => {
    const el = railElement(FULL_ROW, WIDE_RAIL);
    const ref = { current: el };

    const { result } = renderHook(() => useRailScroll({
      scrollRef: ref,
      itemCount: 12,
    }));
    await waitFor(() => expect(result.current.showRight).toBe(false));
    // Let the mount frame settle first, so the assertion below can only be
    // satisfied by the resize path.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 32)); });

    // The window did not change — the queue panel opened beside the row.
    Object.defineProperty(el, 'clientWidth', { value: NARROW_RAIL, configurable: true, writable: true });
    act(() => latestResizeObserver()?.emit());

    await waitFor(() => expect(result.current.showRight).toBe(true));
  });
});
