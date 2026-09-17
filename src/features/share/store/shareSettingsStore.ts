import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ShareSettingsStore {
  navidromeSharingEnabled: boolean;
  navidromeSharesDownloadable: boolean;
  setNavidromeSharingEnabled: (enabled: boolean) => void;
  setNavidromeSharesDownloadable: (downloadable: boolean) => void;
}

export const useShareSettingsStore = create<ShareSettingsStore>()(
  persist(
    set => ({
      navidromeSharingEnabled: false,
      navidromeSharesDownloadable: false,
      setNavidromeSharingEnabled: navidromeSharingEnabled => set({ navidromeSharingEnabled }),
      setNavidromeSharesDownloadable: navidromeSharesDownloadable => set({ navidromeSharesDownloadable }),
    }),
    { name: 'psysonic_share_settings' },
  ),
);

export function _resetShareSettingsStoreForTest(): void {
  useShareSettingsStore.setState({
    navidromeSharingEnabled: false,
    navidromeSharesDownloadable: false,
  });
}
