import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SubsonicShareKind } from '@/lib/api/subsonicSharing';

interface ShareSettingsStore {
  navidromeSharingEnabled: boolean;
  navidromeSharesDownloadable: boolean;
  collapsedServerIds: Record<string, boolean>;
  shareDownloadableByServer: Record<string, Record<string, boolean>>;
  shareKindByServer: Record<string, Record<string, SubsonicShareKind>>;
  setNavidromeSharingEnabled: (enabled: boolean) => void;
  setNavidromeSharesDownloadable: (downloadable: boolean) => void;
  toggleServerCollapsed: (serverId: string) => void;
  rememberShareDownloadable: (serverId: string, shareId: string, downloadable: boolean) => void;
  rememberShareKind: (serverId: string, shareId: string, kind: SubsonicShareKind) => void;
  forgetShareDownloadable: (serverId: string, shareId: string) => void;
  forgetShareKind: (serverId: string, shareId: string) => void;
  forgetServerShareDownloadability: (serverId: string) => void;
  forgetServerShareKinds: (serverId: string) => void;
}

export const useShareSettingsStore = create<ShareSettingsStore>()(
  persist(
    set => ({
      navidromeSharingEnabled: false,
      navidromeSharesDownloadable: false,
      collapsedServerIds: {},
      shareDownloadableByServer: {},
      shareKindByServer: {},
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
      rememberShareKind: (serverId, shareId, kind) => set(state => ({
        shareKindByServer: {
          ...state.shareKindByServer,
          [serverId]: {
            ...state.shareKindByServer[serverId],
            [shareId]: kind,
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
      forgetShareKind: (serverId, shareId) => set(state => {
        const serverShares = { ...state.shareKindByServer[serverId] };
        delete serverShares[shareId];
        const shareKindByServer = { ...state.shareKindByServer };
        if (Object.keys(serverShares).length === 0) delete shareKindByServer[serverId];
        else shareKindByServer[serverId] = serverShares;
        return { shareKindByServer };
      }),
      forgetServerShareDownloadability: serverId => set(state => {
        const shareDownloadableByServer = { ...state.shareDownloadableByServer };
        delete shareDownloadableByServer[serverId];
        return { shareDownloadableByServer };
      }),
      forgetServerShareKinds: serverId => set(state => {
        const shareKindByServer = { ...state.shareKindByServer };
        delete shareKindByServer[serverId];
        return { shareKindByServer };
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
    shareKindByServer: {},
  });
}
