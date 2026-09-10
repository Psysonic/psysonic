import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  SIDE_DEFAULT_PX,
  SIDE_MAX_PX,
  SIDE_MIN_PX,
} from '@/features/burner/utils/burnStage';

/**
 * How wide the user likes the running order.
 *
 * This is a *preference*, not a measurement. The layout clamps it on read
 * against whatever the page can currently afford; the clamped figure is never
 * written back here. Open the app on a laptop, widen the window again, and a
 * 700px list comes back exactly as it was left. Writing the clamp back would
 * destroy that silently, and the user has no way to undo it.
 */
interface BurnerLayoutStore {
  sideWidth: number;
  setSideWidth: (px: number) => void;
  resetSideWidth: () => void;
}

function clampSideWidth(px: number): number {
  return Math.min(SIDE_MAX_PX, Math.max(SIDE_MIN_PX, px));
}

/**
 * Storage can throw outright in a locked-down webview — a Tauri window with
 * site data disabled, or a private context that refuses quota — and a burner
 * that cannot remember a panel width must still open.
 */
const guardedLocalStorage: Storage = {
  get length() {
    try { return window.localStorage.length; } catch { return 0; }
  },
  key(index: number) {
    try { return window.localStorage.key(index); } catch { return null; }
  },
  getItem(name: string) {
    try { return window.localStorage.getItem(name); } catch { return null; }
  },
  setItem(name: string, value: string) {
    try { window.localStorage.setItem(name, value); } catch { /* preference lost, page fine */ }
  },
  removeItem(name: string) {
    try { window.localStorage.removeItem(name); } catch { /* preference lost, page fine */ }
  },
  clear() {
    try { window.localStorage.clear(); } catch { /* preference lost, page fine */ }
  },
};

export const useBurnerLayoutStore = create<BurnerLayoutStore>()(
  persist(
    (set) => ({
      sideWidth: SIDE_DEFAULT_PX,

      setSideWidth: (px) => set({ sideWidth: clampSideWidth(px) }),

      resetSideWidth: () => set({ sideWidth: SIDE_DEFAULT_PX }),
    }),
    {
      name: 'psysonic_burner_layout',
      storage: createJSONStorage(() => guardedLocalStorage),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // A hand-edited store, or one written by a build with different
        // bounds, must not be able to leave the seam outside its own range.
        const w = state.sideWidth;
        state.sideWidth = Number.isFinite(w) ? clampSideWidth(w) : SIDE_DEFAULT_PX;
      },
    }
  )
);
