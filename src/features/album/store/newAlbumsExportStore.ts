import { create } from 'zustand';

/**
 * Open state of the new-albums export dialog. The dialog mounts once at the app
 * root; the keyboard shortcut and the New Releases header button both open it here.
 */
interface NewAlbumsExportDialogStore {
  open: boolean;
  openDialog: () => void;
  closeDialog: () => void;
}

export const useNewAlbumsExportDialogStore = create<NewAlbumsExportDialogStore>()(set => ({
  open: false,
  openDialog: () => set({ open: true }),
  closeDialog: () => set({ open: false }),
}));
