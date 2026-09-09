/**
 * Whether this build has a burn backend, resolved once per process.
 *
 * `burn_is_supported` is a compile-time constant in Rust, but it still arrives
 * over IPC. The context menu has to decide whether to render "Add to CD" while
 * it opens, synchronously, so the answer is cached here rather than fetched per
 * menu.
 *
 * Three states rather than a boolean: "not asked yet" and "no backend" must not
 * look the same, or the Burner page flashes its unsupported-platform notice
 * while the probe is still in flight.
 */
import { create } from 'zustand';
import { burnIsSupported } from '@/lib/api/burn';

export type BurnSupport = 'unknown' | 'yes' | 'no';

interface BurnSupportStore {
  supported: BurnSupport;
  setSupported: (supported: BurnSupport) => void;
}

export const useBurnSupportStore = create<BurnSupportStore>()(set => ({
  supported: 'unknown',
  setSupported: supported => set({ supported }),
}));

let asked = false;

/**
 * Ask the backend once.
 *
 * Safe to call from any mount — only the first call does work — so callers do
 * not have to coordinate about who owns the probe.
 */
export function primeBurnSupport(): void {
  if (asked) return;
  asked = true;
  // Started from `Promise.resolve` because the binding does not always hand
  // back a promise: with no IPC host — a browser dev server, or a test that
  // never installed the Tauri mock — it can return nothing, and `.then` on
  // that throws synchronously, straight out of the effect that called this.
  // Routing every outcome through one chain puts a missing host, a sync throw
  // and a rejection on the same path.
  void Promise.resolve()
    .then(() => burnIsSupported())
    .then(ok => useBurnSupportStore.getState().setSupported(ok ? 'yes' : 'no'))
    .catch(() => {
      useBurnSupportStore.getState().setSupported('no');
    });
}

/** Let a test prime again against a fresh mock. */
export function _resetBurnSupportForTest(): void {
  asked = false;
  useBurnSupportStore.setState({ supported: 'unknown' });
}
