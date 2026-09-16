import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * How the next disc gets written.
 *
 * Lives here rather than beside the panel that edits it: the panel is one
 * reader of these, the page is another, and neither owns them.
 */
export interface BurnSettings {
  /** Sectors/second, or `null` to let the drive choose. */
  writeSpeed: number | null;
  /** Rehearse: drive the whole write with the laser off. */
  testWrite: boolean;
  gapless: boolean;
  normalize: boolean;
  ejectWhenDone: boolean;
  cdText: boolean;
}

export const DEFAULT_SETTINGS: BurnSettings = {
  writeSpeed: null,
  testWrite: false,
  gapless: true,
  normalize: false,
  ejectWhenDone: true,
  // On by default. It was off until a burn had been read back off real
  // hardware; that has now happened on all three platforms, and a disc whose
  // track names a player can show is simply the better disc. A drive that
  // cannot write it turns this off on its own — the value sent to the backend
  // is `settings.cdText && cdTextSupported` — so defaulting to on costs a
  // user with an incapable drive nothing.
  cdText: true,
};

interface BurnSettingsStore {
  settings: BurnSettings;
  patch: (patch: Partial<BurnSettings>) => void;
  reset: () => void;
}

/**
 * Storage can throw outright in a locked-down webview — a Tauri window with
 * site data disabled, or a private context that refuses quota — and a burner
 * that cannot remember its settings must still open.
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

/**
 * A write speed is only usable if it is a real number of sectors per second.
 * Anything else — a string from a hand-edited store, a speed from a drive that
 * is no longer attached — goes back to letting the drive choose.
 */
function cleanWriteSpeed(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function cleanBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Whatever storage held, made into settings a burn can actually run on. */
export function cleanSettings(stored: unknown): BurnSettings {
  const value = (stored ?? {}) as Partial<Record<keyof BurnSettings, unknown>>;
  return {
    writeSpeed: cleanWriteSpeed(value.writeSpeed),
    testWrite: cleanBoolean(value.testWrite, DEFAULT_SETTINGS.testWrite),
    gapless: cleanBoolean(value.gapless, DEFAULT_SETTINGS.gapless),
    normalize: cleanBoolean(value.normalize, DEFAULT_SETTINGS.normalize),
    ejectWhenDone: cleanBoolean(value.ejectWhenDone, DEFAULT_SETTINGS.ejectWhenDone),
    cdText: cleanBoolean(value.cdText, DEFAULT_SETTINGS.cdText),
  };
}

/**
 * The burn options, kept across visits to the page.
 *
 * They used to live in the page's own state, so leaving the burner and coming
 * back silently reset every one of them. Two of those resets matter: CD-TEXT
 * switched itself back on, and Rehearse turned back into a real burn — which on
 * a CD-R cannot be undone.
 */
export const useBurnSettingsStore = create<BurnSettingsStore>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,

      patch: (patch) => set(state => ({ settings: { ...state.settings, ...patch } })),

      reset: () => set({ settings: DEFAULT_SETTINGS }),
    }),
    {
      name: 'psysonic_burn_settings',
      storage: createJSONStorage(() => guardedLocalStorage),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // A hand-edited store, or one written by a build with different
        // options, must not be able to start a burn on values nothing checked.
        state.settings = cleanSettings(state.settings);
      },
    }
  )
);
