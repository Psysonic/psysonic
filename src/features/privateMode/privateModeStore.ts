import { create } from 'zustand';

interface PrivateModeStore {
  active: boolean;
  setActive: (active: boolean) => void;
  toggle: () => void;
}

/**
 * Private mode: while it is on, nothing about what plays leaves the app or lands
 * in its listening history — no server play counts, no scrobbles, no now-playing,
 * no Discord presence, no local play sessions.
 *
 * Deliberately not persisted, so a forgotten switch cannot silently drop weeks
 * of scrobbles; every launch starts with it off.
 */
export const usePrivateModeStore = create<PrivateModeStore>()(set => ({
  active: false,
  setActive: active => set({ active }),
  toggle: () => set(state => ({ active: !state.active })),
}));

export function isPrivateModeActive(): boolean {
  return usePrivateModeStore.getState().active;
}

/** Test-only reset. */
export function _resetPrivateModeForTest(): void {
  usePrivateModeStore.setState({ active: false });
}
