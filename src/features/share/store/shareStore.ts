import { create } from 'zustand';
import {
  createShareForServer as createServerShare,
  deleteShareForServer as deleteServerShare,
  getSharesForServer,
  isSharingDisabledError,
  type SubsonicShare,
  type SubsonicShareKind,
} from '@/lib/api/subsonicSharing';
import { profileProbeFingerprint } from '@/lib/server/serverProbeFingerprint';
import { deriveLibraryBrowseServerIdsWithFallback } from '@/lib/library/libraryBrowseScope';
import { useAuthStore } from '@/store/authStore';
import type { ServerProfile } from '@/store/authStoreTypes';
import {
  resolveNavidromeShareServerEligibility,
  type ShareAvailabilityReason,
  type ShareAvailabilityStatus,
} from '@/features/share/shareAvailability';
import { useShareSettingsStore } from '@/features/share/store/shareSettingsStore';

export interface ServerShareState {
  shares: SubsonicShare[];
  loading: boolean;
  lastSuccessfulRefresh: number | null;
  availability: ShareAvailabilityStatus;
  reason?: ShareAvailabilityReason;
  error?: string;
}

interface ShareStore {
  byServer: Record<string, ServerShareState>;
  reconcileProfiles: (profiles?: readonly ServerProfile[]) => void;
  refreshServer: (serverId: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  createShare: (
    serverId: string,
    resourceIds: readonly string[],
    resourceKind?: SubsonicShareKind,
  ) => Promise<SubsonicShare>;
  deleteShare: (serverId: string, shareId: string) => Promise<void>;
}

const DEFAULT_SERVER_STATE: ServerShareState = {
  shares: [],
  loading: false,
  lastSuccessfulRefresh: null,
  availability: 'unknown',
};

const profileFingerprintByServer = new Map<string, string>();
const profileGenerationByServer = new Map<string, number>();
const mutationRevisionByServer = new Map<string, number>();
const refreshInFlight = new Map<string, { fingerprint: string; promise: Promise<void> }>();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function generation(serverId: string): number {
  return profileGenerationByServer.get(serverId) ?? 0;
}

function bumpGeneration(serverId: string): void {
  profileGenerationByServer.set(serverId, generation(serverId) + 1);
}

function mutationRevision(serverId: string): number {
  return mutationRevisionByServer.get(serverId) ?? 0;
}

function bumpMutationRevision(serverId: string): void {
  mutationRevisionByServer.set(serverId, mutationRevision(serverId) + 1);
}

function currentProfile(serverId: string): ServerProfile | undefined {
  return useAuthStore.getState().servers.find(server => server.id === serverId);
}

function profileRequestIsCurrent(serverId: string, fingerprint: string, requestGeneration: number): boolean {
  const profile = currentProfile(serverId);
  return Boolean(
    profile
    && profileProbeFingerprint(profile) === fingerprint
    && generation(serverId) === requestGeneration,
  );
}

function availabilityAfterError(err: unknown): ShareAvailabilityStatus {
  return isSharingDisabledError(err) ? 'sharing_disabled' : 'server_unavailable';
}

function withKnownMetadata(serverId: string, shares: SubsonicShare[]): SubsonicShare[] {
  const settings = useShareSettingsStore.getState();
  const downloadability = settings.shareDownloadableByServer[serverId];
  const kinds = settings.shareKindByServer[serverId];
  if (!downloadability && !kinds) return shares;
  return shares.map(share => ({
    ...share,
    ...(typeof downloadability?.[share.id] === 'boolean'
      ? { downloadable: downloadability[share.id] }
      : {}),
    ...(kinds?.[share.id] ? { resourceKind: kinds[share.id] } : {}),
  }));
}

export const useShareStore = create<ShareStore>()((set, get) => ({
  byServer: {},

  reconcileProfiles: (profiles = useAuthStore.getState().servers) => {
    const liveIds = new Set(profiles.map(profile => profile.id));
    const configuredIds = new Set(useAuthStore.getState().servers.map(profile => profile.id));
    const staleIds = new Set<string>();

    for (const knownId of profileFingerprintByServer.keys()) {
      if (!liveIds.has(knownId)) staleIds.add(knownId);
    }
    for (const knownId of Object.keys(get().byServer)) {
      if (!liveIds.has(knownId)) staleIds.add(knownId);
    }
    for (const profile of profiles) {
      const fingerprint = profileProbeFingerprint(profile);
      const previous = profileFingerprintByServer.get(profile.id);
      if (previous !== undefined && previous !== fingerprint) staleIds.add(profile.id);
      profileFingerprintByServer.set(profile.id, fingerprint);
    }

    if (staleIds.size === 0) return;
    for (const serverId of staleIds) {
      bumpGeneration(serverId);
      bumpMutationRevision(serverId);
      refreshInFlight.delete(serverId);
      if (!liveIds.has(serverId)) {
        profileFingerprintByServer.delete(serverId);
      }
      if (!configuredIds.has(serverId)) {
        useShareSettingsStore.getState().forgetServerShareDownloadability(serverId);
        useShareSettingsStore.getState().forgetServerShareKinds(serverId);
      }
    }
    set(state => ({
      byServer: Object.fromEntries(
        Object.entries(state.byServer).filter(([serverId]) => !staleIds.has(serverId)),
      ),
    }));
  },

  refreshServer: async serverId => {
    if (!useShareSettingsStore.getState().navidromeSharingEnabled) {
      get().reconcileProfiles([]);
      return;
    }
    get().reconcileProfiles();
    const profile = currentProfile(serverId);
    if (!profile) throw new Error(`Unknown server: ${serverId}`);
    const eligibility = resolveNavidromeShareServerEligibility(
      useAuthStore.getState().subsonicServerIdentityByServer[serverId],
    );
    if (!eligibility.available) {
      set(state => ({
        byServer: {
          ...state.byServer,
          [serverId]: {
            ...DEFAULT_SERVER_STATE,
            availability: 'unsupported',
            reason: eligibility.reason,
          },
        },
      }));
      return;
    }
    const fingerprint = profileProbeFingerprint(profile);
    const existing = refreshInFlight.get(serverId);
    if (existing?.fingerprint === fingerprint) return existing.promise;

    const requestGeneration = generation(serverId);
    const requestMutationRevision = mutationRevision(serverId);
    set(state => ({
      byServer: {
        ...state.byServer,
        [serverId]: {
          ...(state.byServer[serverId] ?? DEFAULT_SERVER_STATE),
          loading: true,
          error: undefined,
        },
      },
    }));

    const promise = getSharesForServer(serverId)
      .then(shares => {
        if (
          !profileRequestIsCurrent(serverId, fingerprint, requestGeneration)
          || mutationRevision(serverId) !== requestMutationRevision
        ) return;
        set(state => ({
          byServer: {
            ...state.byServer,
            [serverId]: {
              shares: withKnownMetadata(serverId, shares),
              loading: false,
              lastSuccessfulRefresh: Date.now(),
              availability: 'available',
              reason: undefined,
            },
          },
        }));
      })
      .catch(err => {
        if (
          profileRequestIsCurrent(serverId, fingerprint, requestGeneration)
          && mutationRevision(serverId) === requestMutationRevision
        ) {
          set(state => ({
            byServer: {
              ...state.byServer,
              [serverId]: {
                ...(state.byServer[serverId] ?? DEFAULT_SERVER_STATE),
                loading: false,
                availability: availabilityAfterError(err),
                reason: isSharingDisabledError(err) ? 'sharing_disabled' : 'server_unavailable',
                error: errorMessage(err),
              },
            },
          }));
        }
        throw err;
      })
      .finally(() => {
        if (refreshInFlight.get(serverId)?.promise === promise) refreshInFlight.delete(serverId);
      });
    refreshInFlight.set(serverId, { fingerprint, promise });
    return promise;
  },

  refreshAll: async () => {
    if (!useShareSettingsStore.getState().navidromeSharingEnabled) {
      get().reconcileProfiles([]);
      return;
    }
    const auth = useAuthStore.getState();
    const selectedServerIds = new Set(deriveLibraryBrowseServerIdsWithFallback(auth));
    const profiles = auth.servers.filter(profile => selectedServerIds.has(profile.id));
    get().reconcileProfiles(profiles);
    await Promise.allSettled(profiles.map(profile => get().refreshServer(profile.id)));
  },

  createShare: async (serverId, resourceIds, resourceKind) => {
    if (!useShareSettingsStore.getState().navidromeSharingEnabled) {
      throw new Error('Navidrome sharing is disabled in settings');
    }
    get().reconcileProfiles();
    const profile = currentProfile(serverId);
    if (!profile) throw new Error(`Unknown server: ${serverId}`);
    const fingerprint = profileProbeFingerprint(profile);
    const requestGeneration = generation(serverId);
    bumpMutationRevision(serverId);

    try {
      const settings = useShareSettingsStore.getState();
      const downloadable = settings.navidromeSharesDownloadable;
      const share = await createServerShare(serverId, resourceIds, { downloadable });
      const createdShare = { ...share, downloadable, ...(resourceKind ? { resourceKind } : {}) };
      if (profileRequestIsCurrent(serverId, fingerprint, requestGeneration)) {
        settings.rememberShareDownloadable(serverId, share.id, downloadable);
        if (resourceKind) settings.rememberShareKind(serverId, share.id, resourceKind);
        bumpMutationRevision(serverId);
        set(state => {
          const previous = state.byServer[serverId] ?? DEFAULT_SERVER_STATE;
          return {
            byServer: {
              ...state.byServer,
              [serverId]: {
                ...previous,
                shares: [createdShare, ...previous.shares.filter(existing => existing.id !== share.id)],
                loading: false,
                availability: 'available',
                reason: undefined,
                error: undefined,
              },
            },
          };
        });
      }
      return createdShare;
    } catch (err) {
      if (profileRequestIsCurrent(serverId, fingerprint, requestGeneration)) {
        set(state => {
          const previous = state.byServer[serverId] ?? DEFAULT_SERVER_STATE;
          return {
            byServer: {
              ...state.byServer,
              [serverId]: {
                ...previous,
                loading: false,
                availability: isSharingDisabledError(err) ? 'sharing_disabled' : previous.availability,
                reason: isSharingDisabledError(err) ? 'sharing_disabled' : previous.reason,
                error: errorMessage(err),
              },
            },
          };
        });
      }
      throw err;
    }
  },

  deleteShare: async (serverId, shareId) => {
    if (!useShareSettingsStore.getState().navidromeSharingEnabled) {
      throw new Error('Navidrome sharing is disabled in settings');
    }
    get().reconcileProfiles();
    const profile = currentProfile(serverId);
    if (!profile) throw new Error(`Unknown server: ${serverId}`);
    const fingerprint = profileProbeFingerprint(profile);
    const requestGeneration = generation(serverId);
    bumpMutationRevision(serverId);

    try {
      await deleteServerShare(serverId, shareId);
      useShareSettingsStore.getState().forgetShareDownloadable(serverId, shareId);
      useShareSettingsStore.getState().forgetShareKind(serverId, shareId);
      if (!profileRequestIsCurrent(serverId, fingerprint, requestGeneration)) return;
      bumpMutationRevision(serverId);
      set(state => {
        const previous = state.byServer[serverId] ?? DEFAULT_SERVER_STATE;
        return {
          byServer: {
            ...state.byServer,
            [serverId]: {
              ...previous,
              shares: previous.shares.filter(share => share.id !== shareId),
              loading: false,
              availability: 'available',
              reason: undefined,
              error: undefined,
            },
          },
        };
      });
    } catch (err) {
      if (profileRequestIsCurrent(serverId, fingerprint, requestGeneration)) {
        set(state => ({
          byServer: {
            ...state.byServer,
            [serverId]: {
              ...(state.byServer[serverId] ?? DEFAULT_SERVER_STATE),
              loading: false,
              error: errorMessage(err),
            },
          },
        }));
      }
      throw err;
    }
  },
}));

export function _resetShareStoreForTest(): void {
  profileFingerprintByServer.clear();
  profileGenerationByServer.clear();
  mutationRevisionByServer.clear();
  refreshInFlight.clear();
  useShareStore.setState(useShareStore.getInitialState(), true);
}
