import { create } from 'zustand';

interface BurnRecorderStore {
  /** Recorder id the burner writes to, or '' when none has been chosen yet. */
  selectedId: string;
  select: (id: string) => void;
}

/**
 * Which drive the burner writes to.
 *
 * Here rather than in the page because the burner can be left and returned to:
 * page state dies with the page, and the drive picker would then quietly fall
 * back to the first writable drive. On a machine with two burners that means
 * the next burn goes to a drive the user did not choose.
 *
 * Deliberately not persisted. Surviving navigation is the bug being fixed;
 * remembering a drive across restarts is a different decision, and a recorder
 * id from a drive that has since been unplugged is not worth the trouble it
 * would cause. `useBurnRecorders` validates whatever is here against the drives
 * it actually finds.
 */
export const useBurnRecorderStore = create<BurnRecorderStore>()((set) => ({
  selectedId: '',
  select: (selectedId) => set({ selectedId }),
}));
