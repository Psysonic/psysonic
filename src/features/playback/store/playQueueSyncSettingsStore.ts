import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PlayQueueSyncSettingsStore {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

export const usePlayQueueSyncSettingsStore = create<PlayQueueSyncSettingsStore>()(
  persist(
    set => ({
      enabled: true,
      setEnabled: enabled => set({ enabled }),
    }),
    { name: 'psysonic_play_queue_sync_settings' },
  ),
);

export function isPlayQueueSyncEnabled(): boolean {
  return usePlayQueueSyncSettingsStore.getState().enabled;
}

export function _resetPlayQueueSyncSettingsStoreForTest(): void {
  usePlayQueueSyncSettingsStore.setState({ enabled: true });
}
