import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ShareSettingsStore {
  navidromeSharingEnabled: boolean;
  navidromeSharesDownloadable: boolean;
  collapsedServerIds: Record<string, boolean>;
  shareDownloadableByServer: Record<string, Record<string, boolean>>;
  setNavidromeSharingEnabled: (enabled: boolean) => void;
  setNavidromeSharesDownloadable: (downloadable: boolean) => void;
  toggleServerCollapsed: (serverId: string) => void;
  rememberShareDownloadable: (serverId: string, shareId: string, downloadable: boolean) => void;
  forgetShareDownloadable: (serverId: string, shareId: string) => void;
  forgetServerShareDownloadability: (serverId: string) => void;
}

export const useShareSettingsStore = create<ShareSettingsStore>()(
  persist(
    set => ({
      navidromeSharingEnabled: false,
      navidromeSharesDownloadable: false,
      collapsedServerIds: {},
      shareDownloadableByServer: {},
      setNavidromeSharingEnabled: navidromeSharingEnabled => set({ navidromeSharingEnabled }),
      setNavidromeSharesDownloadable: navidromeSharesDownloadable => set({ navidromeSharesDownloadable }),
      toggleServerCollapsed: serverId => set(state => ({
        collapsedServerIds: {
          ...state.collapsedServerIds,
          [serverId]: !state.collapsedServerIds[serverId],
        },
      })),
      rememberShareDownloadable: (serverId, shareId, downloadable) => set(state => ({
        shareDownloadableByServer: {
          ...state.shareDownloadableByServer,
          [serverId]: {
            ...state.shareDownloadableByServer[serverId],
            [shareId]: downloadable,
          },
        },
      })),
      forgetShareDownloadable: (serverId, shareId) => set(state => {
        const serverShares = { ...state.shareDownloadableByServer[serverId] };
        delete serverShares[shareId];
        const shareDownloadableByServer = { ...state.shareDownloadableByServer };
        if (Object.keys(serverShares).length === 0) delete shareDownloadableByServer[serverId];
        else shareDownloadableByServer[serverId] = serverShares;
        return { shareDownloadableByServer };
      }),
      forgetServerShareDownloadability: serverId => set(state => {
        const shareDownloadableByServer = { ...state.shareDownloadableByServer };
        delete shareDownloadableByServer[serverId];
        return { shareDownloadableByServer };
      }),
    }),
    { name: 'psysonic_share_settings' },
  ),
);

export function _resetShareSettingsStoreForTest(): void {
  useShareSettingsStore.setState({
    navidromeSharingEnabled: false,
    navidromeSharesDownloadable: false,
    collapsedServerIds: {},
    shareDownloadableByServer: {},
  });
}
