import { beforeEach, describe, expect, it } from 'vitest';
import { useBurnerLayoutStore } from '@/features/burner/store/burnerLayoutStore';
import { SIDE_DEFAULT_PX, SIDE_MAX_PX, SIDE_MIN_PX } from '@/features/burner/utils/burnStage';

type State = ReturnType<typeof useBurnerLayoutStore.getState>;

/**
 * Drives the persist middleware's rehydrate hook against a stored snapshot.
 * That hook is the risky path: the stored number comes back from disk with no
 * guarantee at all, and a width outside the seam's own range leaves the user
 * dragging a control that cannot reach its own value.
 */
function rehydrate(stored: unknown): State {
  const state = { ...useBurnerLayoutStore.getState(), sideWidth: stored } as unknown as State;
  useBurnerLayoutStore.persist.getOptions().onRehydrateStorage?.(state)?.(state, undefined);
  return state;
}

describe('burnerLayoutStore', () => {
  beforeEach(() => {
    useBurnerLayoutStore.getState().resetSideWidth();
  });

  it('starts at the default width', () => {
    expect(useBurnerLayoutStore.getState().sideWidth).toBe(SIDE_DEFAULT_PX);
    expect(SIDE_DEFAULT_PX).toBe(420);
  });

  it('clamps a width written above the maximum', () => {
    useBurnerLayoutStore.getState().setSideWidth(1200);
    expect(useBurnerLayoutStore.getState().sideWidth).toBe(SIDE_MAX_PX);
  });

  it('clamps a width written below the minimum', () => {
    useBurnerLayoutStore.getState().setSideWidth(100);
    expect(useBurnerLayoutStore.getState().sideWidth).toBe(SIDE_MIN_PX);
  });

  it('keeps a width inside the range untouched', () => {
    useBurnerLayoutStore.getState().setSideWidth(537);
    expect(useBurnerLayoutStore.getState().sideWidth).toBe(537);
  });

  it('resetSideWidth returns to the default', () => {
    useBurnerLayoutStore.getState().setSideWidth(700);
    useBurnerLayoutStore.getState().resetSideWidth();
    expect(useBurnerLayoutStore.getState().sideWidth).toBe(SIDE_DEFAULT_PX);
  });

  it('rehydrates a nonsense width to the default', () => {
    expect(rehydrate(Number.NaN).sideWidth).toBe(SIDE_DEFAULT_PX);
    expect(rehydrate(null).sideWidth).toBe(SIDE_DEFAULT_PX);
    expect(rehydrate(undefined).sideWidth).toBe(SIDE_DEFAULT_PX);
    expect(rehydrate('420').sideWidth).toBe(SIDE_DEFAULT_PX);
    expect(rehydrate(Number.POSITIVE_INFINITY).sideWidth).toBe(SIDE_DEFAULT_PX);
  });

  it('rehydrates an out-of-range width into the range', () => {
    expect(rehydrate(0).sideWidth).toBe(SIDE_MIN_PX);
    expect(rehydrate(9999).sideWidth).toBe(SIDE_MAX_PX);
    expect(rehydrate(-40).sideWidth).toBe(SIDE_MIN_PX);
  });

  it('rehydrates a legitimate stored width unchanged', () => {
    expect(rehydrate(612).sideWidth).toBe(612);
  });

  it('survives a missing state object', () => {
    expect(() =>
      useBurnerLayoutStore.persist.getOptions().onRehydrateStorage?.(useBurnerLayoutStore.getState())?.(
        undefined,
        undefined,
      )
    ).not.toThrow();
  });
});
