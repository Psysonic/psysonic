import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFsElementHeightVar } from './useFsElementHeightVar';
import { latestResizeObserver } from '@/test/mocks/browser';

/**
 * jsdom does no layout, so the measured element describes its own height. The
 * numbers are the two states measured on the real player: the bottom cluster is
 * ~350px with the visualizer strip off and ~450px with it on — the spread that
 * made a fixed reserve wrong (issue #1546).
 */
function elementOfHeight(height: number) {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ height } as DOMRect);
  return el;
}

const WITHOUT_VISUALIZER = 350;
const WITH_VISUALIZER = 450;
const VAR = '--fsp-foot-h';

describe('useFsElementHeightVar', () => {
  it('publishes the measured height on the root', () => {
    const root = document.createElement('div');
    const element = elementOfHeight(WITHOUT_VISUALIZER);

    renderHook(() => useFsElementHeightVar({ current: root }, { current: element }, VAR));

    expect(root.style.getPropertyValue(VAR)).toBe('350px');
  });

  it('follows the element when it grows', () => {
    const root = document.createElement('div');
    const element = elementOfHeight(WITHOUT_VISUALIZER);

    renderHook(() => useFsElementHeightVar({ current: root }, { current: element }, VAR));

    element.getBoundingClientRect = () => ({ height: WITH_VISUALIZER } as DOMRect);
    act(() => { latestResizeObserver()?.emit(); });

    expect(root.style.getPropertyValue(VAR)).toBe('450px');
  });

  it('writes the variable it was given', () => {
    const root = document.createElement('div');
    const element = elementOfHeight(WITH_VISUALIZER);

    renderHook(() => useFsElementHeightVar({ current: root }, { current: element }, '--fs-cluster-h'));

    expect(root.style.getPropertyValue('--fs-cluster-h')).toBe('450px');
    expect(root.style.getPropertyValue(VAR)).toBe('');
  });

  it('drops the variable on unmount so a stale height cannot survive', () => {
    const root = document.createElement('div');
    const element = elementOfHeight(WITH_VISUALIZER);

    const { unmount } = renderHook(() => useFsElementHeightVar({ current: root }, { current: element }, VAR));
    expect(root.style.getPropertyValue(VAR)).toBe('450px');

    unmount();

    expect(root.style.getPropertyValue(VAR)).toBe('');
  });

  it('does nothing without both elements', () => {
    const root = document.createElement('div');

    renderHook(() => useFsElementHeightVar({ current: root }, { current: null }, VAR));

    expect(root.style.getPropertyValue(VAR)).toBe('');
  });
});
