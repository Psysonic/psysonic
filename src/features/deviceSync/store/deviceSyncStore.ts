import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { resolveStorageServerIndexKey, serverIndexKeyForProfile } from '@/lib/server/serverIndexKey';
import { findServerInListByIdOrIndexKey } from '@/lib/server/serverLookup';
import { useAuthStore } from '@/store/authStore';
import type { ServerProfile } from '@/store/authStoreTypes';
import {
  repairedManifestFiles,
  repairedManifestPlaylists,
} from '@/features/deviceSync/utils/deviceSyncOwnerKeys';
import { canonicalNavidromeId } from '@/lib/server/navidromeCanonicalId';
import { navidromeCanonicalCheckpointStatus } from '@/lib/server/navidromeCanonicalCheckpointStatus';
import { createNavidromeCanonicalMigrationAwareJSONStorage } from '@/lib/util/safeStorage';
import { withPlaylistPathIds } from '@/features/deviceSync/utils/deviceSyncHelpers';

export interface DeviceSyncSource {
  type: 'album' | 'playlist' | 'artist';
  id: string;
  name: string;
  serverIndexKey: string;
  /**
   * Identity of the owning server profile, recorded alongside the address-
   * derived `serverIndexKey`. The index key is how the device and the source
   * keys are addressed, but it dies when the server moves; this one survives
   * that and lets the owner be recognized and followed to its new address.
   * Absent on sources selected before this was recorded.
   */
  serverProfileId?: string;
  /** Stable folder discriminator assigned when playlist display names collide. */
  pathId?: string;
  /** Album artist — only set when type === 'album'. Shown as a subtitle in the device list. */
  artist?: string;
}

export type DeviceSyncLayoutMode = 'self-contained' | 'shared-album-tree';
export type DeviceSyncPlaylistPathMode = 'playlist-relative' | 'device-rooted';

export interface DeviceSyncManifestFile {
  trackId: string;
  relativePath: string;
  sourceKeys: string[];
  sizeBytes: number;
}

export interface DeviceSyncManifestPlaylist {
  sourceKey: string;
  relativePath: string;
}

export type LegacyDeviceSyncSource = Omit<DeviceSyncSource, 'serverIndexKey'>;

export type DeviceSyncManifest = {
  version?: number;
  schema?: string;
  canonicalIdVersion?: number;
  ownerServerIndexKey?: string;
  /** Additive since 1.53: stable identity of the owning profile. */
  ownerServerProfileId?: string;
  sources?: unknown[];
  layoutMode?: DeviceSyncLayoutMode;
  playlistPathMode?: DeviceSyncPlaylistPathMode;
  files?: unknown[];
  playlists?: unknown[];
};

export function deviceSyncSourceKey(source: Pick<DeviceSyncSource, 'serverIndexKey' | 'type' | 'id'>): string {
  return JSON.stringify([source.serverIndexKey, source.type, source.id]);
}

export function deviceSyncOwnerKey(sources: readonly DeviceSyncSource[]): string | null {
  const owner = sources[0]?.serverIndexKey?.trim();
  if (!owner || sources.some(source => source.serverIndexKey !== owner)) return null;
  return owner;
}

/**
 * The owner key of a configuration whose server is no longer configured, or
 * `null` when the owner resolves (or there is none).
 *
 * Device Sync binds sources to a server by address, so a server that moves to a
 * new one leaves every source pointing at an identity nothing resolves to.
 * Callers must treat that as "no server" rather than passing the key on:
 * `resolveServerIdForIndexKey` hands unmatched keys back unchanged, and the API
 * layer then fails with an opaque `Unknown server` deep inside a request.
 */
/**
 * Current address of a recorded owner profile, or `null` when that profile is
 * not configured here.
 *
 * Only an exact id match counts. There is deliberately no fallback: a profile
 * id and a single-label hostname cannot be told apart by shape (see
 * `mintedServerProfileIds` in the auth store), so guessing would turn an
 * unknown id into a bogus address.
 */
export function deviceSyncOwnerIndexKeyForProfileId(
  serverProfileId: string | undefined,
): string | null {
  if (!serverProfileId) return null;
  const server = useAuthStore.getState().servers?.find(s => s.id === serverProfileId);
  return server ? serverIndexKeyForProfile(server) || null : null;
}

export function deviceSyncUnresolvedOwnerKey(
  sources: readonly DeviceSyncSource[],
  servers: readonly ServerProfile[],
): string | null {
  const owner = deviceSyncOwnerKey(sources);
  if (!owner) return null;
  if (findServerInListByIdOrIndexKey(servers, owner)) return null;
  // A recorded profile that still exists is not a dead owner but a moved one:
  // it resolves on its own and needs no decision from the user.
  return deviceSyncOwnerRelocation(sources, servers) ? null : owner;
}

/**
 * The address move a configuration needs to follow, or `null` when it is
 * already current (or carries no profile identity to follow).
 *
 * This is the self-healing half of the address problem: sources recorded with a
 * profile id can be re-keyed onto that profile's current address without asking
 * anyone. Sources from before the id was recorded cannot, and fall through to
 * the manual repair instead.
 */
export function deviceSyncOwnerRelocation(
  sources: readonly DeviceSyncSource[],
  servers: readonly ServerProfile[],
): { from: string; to: string } | null {
  const from = deviceSyncOwnerKey(sources);
  if (!from) return null;
  const profileId = sources[0]?.serverProfileId;
  if (!profileId || sources.some(source => source.serverProfileId !== profileId)) return null;
  const server = servers.find(candidate => candidate.id === profileId);
  if (!server) return null;
  const to = serverIndexKeyForProfile(server);
  return to && to !== from ? { from, to } : null;
}

function isDeviceSyncSource(value: unknown): value is DeviceSyncSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<DeviceSyncSource>;
  return (
    (source.type === 'album' || source.type === 'playlist' || source.type === 'artist') &&
    typeof source.id === 'string' && source.id.length > 0 &&
    typeof source.name === 'string' &&
    typeof source.serverIndexKey === 'string' && source.serverIndexKey.length > 0 &&
    (source.pathId === undefined || (typeof source.pathId === 'string' && source.pathId.length > 0)) &&
    (source.serverProfileId === undefined
      || (typeof source.serverProfileId === 'string' && source.serverProfileId.length > 0))
  );
}

function isLegacyDeviceSyncSource(value: unknown): value is LegacyDeviceSyncSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<DeviceSyncSource>;
  return (
    (source.type === 'album' || source.type === 'playlist' || source.type === 'artist') &&
    typeof source.id === 'string' && source.id.length > 0 &&
    typeof source.name === 'string' &&
    !source.serverIndexKey
  );
}

function isSupportedDeviceSyncManifest(manifest: DeviceSyncManifest): boolean {
  if (manifest.version !== undefined
    && (!Number.isInteger(manifest.version) || manifest.version < 1 || manifest.version > 4)) return false;
  if (manifest.schema !== undefined && manifest.schema !== 'fixed-v1' && manifest.schema !== 'fixed-v2') return false;
  if (manifest.version === 3 && manifest.schema !== 'fixed-v1') return false;
  if (manifest.version === 4 && manifest.schema !== 'fixed-v2') return false;
  if (manifest.canonicalIdVersion !== undefined && manifest.canonicalIdVersion !== 1) return false;
  if (manifest.layoutMode !== undefined
    && manifest.layoutMode !== 'self-contained'
    && manifest.layoutMode !== 'shared-album-tree') return false;
  if (manifest.playlistPathMode !== undefined
    && manifest.playlistPathMode !== 'playlist-relative'
    && manifest.playlistPathMode !== 'device-rooted') return false;
  return true;
}

function isManifestFile(value: unknown): value is DeviceSyncManifestFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Partial<DeviceSyncManifestFile>;
  return typeof file.trackId === 'string'
    && typeof file.relativePath === 'string'
    && Array.isArray(file.sourceKeys)
    && file.sourceKeys.every(key => typeof key === 'string')
    && typeof file.sizeBytes === 'number';
}

function isManifestPlaylist(value: unknown): value is DeviceSyncManifestPlaylist {
  if (!value || typeof value !== 'object') return false;
  const playlist = value as Partial<DeviceSyncManifestPlaylist>;
  return typeof playlist.sourceKey === 'string' && typeof playlist.relativePath === 'string';
}

function canonicalManifestSourceKey(sourceKey: string, ownerServerIndexKey: string): string {
  try {
    const value = JSON.parse(sourceKey) as unknown;
    if (!Array.isArray(value) || value.length !== 3 || value.some(part => typeof part !== 'string')) {
      return sourceKey;
    }
    if (resolveStorageServerIndexKey(value[0]) !== ownerServerIndexKey) return sourceKey;
    return JSON.stringify([ownerServerIndexKey, value[1], canonicalNavidromeId(value[2])]);
  } catch {
    return sourceKey;
  }
}

export function deviceSyncSourcesFromManifest(
  manifest: DeviceSyncManifest | null,
): DeviceSyncSource[] {
  return deviceSyncManifestImport(manifest)?.sources ?? [];
}

export function deviceSyncManifestImport(
  manifest: DeviceSyncManifest | null,
): {
  ownerServerIndexKey: string;
  sources: DeviceSyncSource[];
  layoutMode: DeviceSyncLayoutMode;
  playlistPathMode: DeviceSyncPlaylistPathMode;
  files: DeviceSyncManifestFile[];
  playlists: DeviceSyncManifestPlaylist[];
  hasMaterializedPlan: boolean;
  /**
   * The manifest carries an explicit layout configuration. Manifests written
   * before the layout modes existed do not, and their reported `layoutMode` /
   * `playlistPathMode` are this module's defaults rather than a device fact —
   * adopting those as the *desired* configuration would silently discard the
   * user's choice on every attach.
   */
  declaresConfiguration: boolean;
} | null {
  if (!manifest || !isSupportedDeviceSyncManifest(manifest) || !Array.isArray(manifest.sources)) return null;
  const manifestOwner = manifest.ownerServerIndexKey
    ? resolveStorageServerIndexKey(manifest.ownerServerIndexKey)
    : null;
  const sources: DeviceSyncSource[] = [];
  for (const source of manifest.sources) {
    if (isDeviceSyncSource(source)) {
      const serverIndexKey = resolveStorageServerIndexKey(source.serverIndexKey);
      if (!serverIndexKey) return null;
      sources.push({ ...source, serverIndexKey });
      continue;
    }
    if (isLegacyDeviceSyncSource(source) && manifestOwner) {
      sources.push({ ...source, serverIndexKey: manifestOwner });
      continue;
    }
    return null;
  }
  const owner = deviceSyncOwnerKey(sources);
  if ((!owner && sources.length > 0) || (owner && manifestOwner && manifestOwner !== owner)) return null;
  const recordedOwner = owner ?? manifestOwner;
  if (!recordedOwner) return null;
  // A configured profile id outranks the address the device recorded: the
  // manifest may have been written before the server moved, which makes that
  // address stale by definition. Following the profile here is what keeps a
  // changed address from stranding the whole configuration.
  const profileOwner = deviceSyncOwnerIndexKeyForProfileId(manifest.ownerServerProfileId);
  const ownerServerIndexKey = profileOwner ?? recordedOwner;
  const ownerMoved = ownerServerIndexKey !== recordedOwner;
  const checkpointStatus = navidromeCanonicalCheckpointStatus(ownerServerIndexKey);
  if (checkpointStatus === 'invalid' || checkpointStatus === 'pending') return null;
  const normalized = new Map<string, DeviceSyncSource>();
  for (const source of sources) {
    const owned: DeviceSyncSource = {
      ...source,
      serverIndexKey: ownerServerIndexKey,
      ...(manifest.ownerServerProfileId
        ? { serverProfileId: manifest.ownerServerProfileId }
        : {}),
    };
    const next = checkpointStatus === 'ready'
      ? { ...owned, id: canonicalNavidromeId(owned.id) }
      : owned;
    normalized.set(deviceSyncSourceKey(next), next);
  }
  if ((manifest.files === undefined) !== (manifest.playlists === undefined)) return null;
  const hasMaterializedPlan = manifest.files !== undefined;
  const rawFiles = manifest.files ?? [];
  const rawPlaylists = manifest.playlists ?? [];
  if (!rawFiles.every(isManifestFile) || !rawPlaylists.every(isManifestPlaylist)) return null;
  // The plan addresses its entries by the old owner key, so it has to move with
  // the sources — otherwise every file on the device looks unclaimed and the
  // next sync downloads it again.
  const files = ownerMoved
    ? repairedManifestFiles(rawFiles, recordedOwner, ownerServerIndexKey)
    : rawFiles;
  const playlists = ownerMoved
    ? repairedManifestPlaylists(rawPlaylists, recordedOwner, ownerServerIndexKey)
    : rawPlaylists;
  const normalizedFiles = checkpointStatus === 'ready'
    ? files.map(file => ({
        ...file,
        trackId: canonicalNavidromeId(file.trackId),
        sourceKeys: file.sourceKeys.map(key => canonicalManifestSourceKey(key, ownerServerIndexKey)),
      }))
    : files;
  const normalizedPlaylists = checkpointStatus === 'ready'
    ? playlists.map(playlist => ({
        ...playlist,
        sourceKey: canonicalManifestSourceKey(playlist.sourceKey, ownerServerIndexKey),
      }))
    : playlists;
  return {
    ownerServerIndexKey,
    sources: withPlaylistPathIds([...normalized.values()]),
    layoutMode: manifest.layoutMode ?? 'self-contained',
    playlistPathMode: manifest.playlistPathMode ?? 'playlist-relative',
    files: normalizedFiles,
    playlists: normalizedPlaylists,
    hasMaterializedPlan,
    declaresConfiguration: manifest.layoutMode !== undefined
      || manifest.playlistPathMode !== undefined,
  };
}

export function deviceSyncLegacySourcesFromManifest(
  manifest: DeviceSyncManifest | null,
): LegacyDeviceSyncSource[] {
  if (!manifest
    || !isSupportedDeviceSyncManifest(manifest)
    || manifest.ownerServerIndexKey
    || !Array.isArray(manifest.sources)) return [];
  const legacy = new Map<string, LegacyDeviceSyncSource>();
  for (const source of manifest.sources) {
    if (!isLegacyDeviceSyncSource(source)) return [];
    legacy.set(JSON.stringify([source.type, source.id]), source);
  }
  return [...legacy.values()];
}

export function migrateDeviceSyncPersistedState(persisted: unknown): Partial<DeviceSyncState> {
  const state = persisted as Partial<DeviceSyncState> | undefined;
  const persistedSources = Array.isArray(state?.sources) ? state.sources : [];
  const persistedLegacySources = Array.isArray(state?.legacySources) ? state.legacySources : [];
  const legacySources = [
    ...persistedLegacySources.filter(isLegacyDeviceSyncSource),
    ...persistedSources.filter(isLegacyDeviceSyncSource),
  ];
  return {
    ...state,
    layoutMode: state?.layoutMode === 'shared-album-tree' ? 'shared-album-tree' : 'self-contained',
    playlistPathMode: state?.playlistPathMode === 'device-rooted' ? 'device-rooted' : 'playlist-relative',
    syncedLayoutMode: state?.syncedLayoutMode === 'shared-album-tree' ? 'shared-album-tree' : 'self-contained',
    syncedPlaylistPathMode: state?.syncedPlaylistPathMode === 'device-rooted' ? 'device-rooted' : 'playlist-relative',
    sources: withPlaylistPathIds(persistedSources.filter(isDeviceSyncSource)),
    legacySources,
    legacyTargetDir: legacySources.length > 0
      ? (typeof state?.legacyTargetDir === 'string' ? state.legacyTargetDir : state?.targetDir ?? null)
      : null,
    checkedIds: [],
    pendingDeletion: Array.isArray(state?.pendingDeletion)
      ? [...new Set(state.pendingDeletion.filter((value): value is string => typeof value === 'string'))]
      : [],
    pendingPlan: false,
    targetDeviceId: typeof state?.targetDeviceId === 'string' ? state.targetDeviceId : null,
    pendingPlanDeviceId: null,
    pendingPlanChecked: false,
    targetRevision: 0,
  };
}

export type DeviceSyncLegacyRecovery =
  | { result: 'recovered'; sources: DeviceSyncSource[] }
  | { result: 'pending' | 'owner-conflict' };

export function prepareDeviceSyncLegacyRecovery(args: {
  sources: readonly DeviceSyncSource[];
  legacySources: readonly LegacyDeviceSyncSource[];
  serverIndexKey: string;
}): DeviceSyncLegacyRecovery {
  const serverIndexKey = resolveStorageServerIndexKey(args.serverIndexKey);
  const checkpointStatus = serverIndexKey
    ? navidromeCanonicalCheckpointStatus(serverIndexKey)
    : 'invalid';
  if (!serverIndexKey || checkpointStatus === 'invalid' || checkpointStatus === 'pending') {
    return { result: 'pending' };
  }
  const currentOwner = deviceSyncOwnerKey(args.sources);
  if (currentOwner && currentOwner !== serverIndexKey) return { result: 'owner-conflict' };
  const recovered = args.legacySources.map(source => ({
    ...source,
    id: checkpointStatus === 'ready' ? canonicalNavidromeId(source.id) : source.id,
    serverIndexKey,
  }));
  const merged = new Map(args.sources.map(source => [deviceSyncSourceKey(source), source]));
  recovered.forEach(source => merged.set(deviceSyncSourceKey(source), source));
  return { result: 'recovered', sources: withPlaylistPathIds([...merged.values()]) };
}

interface DeviceSyncState {
  targetDir: string | null;
  layoutMode: DeviceSyncLayoutMode;
  playlistPathMode: DeviceSyncPlaylistPathMode;
  syncedLayoutMode: DeviceSyncLayoutMode;
  syncedPlaylistPathMode: DeviceSyncPlaylistPathMode;
  sources: DeviceSyncSource[];        // persistent device content list
  legacySources: LegacyDeviceSyncSource[]; // ownerless v0 selections awaiting explicit recovery
  legacyTargetDir: string | null;     // device the quarantined ownerless sources came from
  checkedIds: string[];               // currently checked for bulk actions (not persisted)
  pendingDeletion: string[];          // source IDs marked for deletion; persisted for crash-safe retry
  pendingPlan: boolean;               // active native plan awaiting finalization or cleanup
  targetDeviceId: string | null;      // device identity associated with the persisted desired state
  pendingPlanDeviceId: string | null; // active plan identity detected on the selected device
  pendingPlanChecked: boolean;        // native plan state was checked for the selected target
  targetRevision: number;             // forces a same-path manual target recheck
  deviceFilePaths: string[];          // actual file paths found on the device (not persisted)
  scanning: boolean;                   // true while scanning the device

  setTargetDir: (dir: string | null) => void;
  setLayoutMode: (mode: DeviceSyncLayoutMode) => void;
  setPlaylistPathMode: (mode: DeviceSyncPlaylistPathMode) => void;
  applyManifestConfiguration: (
    layoutMode: DeviceSyncLayoutMode,
    playlistPathMode: DeviceSyncPlaylistPathMode,
    manifestDeclaresConfiguration: boolean,
  ) => void;
  markConfigurationSynced: (
    layoutMode: DeviceSyncLayoutMode,
    playlistPathMode: DeviceSyncPlaylistPathMode,
  ) => void;
  addSource: (source: DeviceSyncSource) => void;
  removeSource: (id: string) => void;
  clearSources: () => void;
  reassignSourceOwner: (nextOwnerServerIndexKey: string) => void;
  setLegacySources: (sources: LegacyDeviceSyncSource[], targetDir?: string | null) => void;
  quarantineLegacySources: (targetDir: string, sources: LegacyDeviceSyncSource[]) => void;
  recoverLegacySources: (serverIndexKey: string) => 'recovered' | 'pending' | 'owner-conflict';
  discardLegacySources: () => void;
  toggleChecked: (id: string) => void;
  setCheckedIds: (ids: string[]) => void;
  markForDeletion: (ids: string[]) => void;
  unmarkDeletion: (id: string) => void;
  clearPendingDeletion: () => void;
  setPendingPlan: (pending: boolean) => void;
  setTargetDeviceId: (deviceId: string | null) => void;
  setPendingPlanDeviceId: (deviceId: string | null) => void;
  setPendingPlanChecked: (checked: boolean) => void;
  removeSources: (ids: string[]) => void;
  setDeviceFilePaths: (paths: string[]) => void;
  setScanning: (v: boolean) => void;
}

export const useDeviceSyncStore = create<DeviceSyncState>()(
  persist(
    (set, get) => ({
      targetDir: null,
      layoutMode: 'self-contained',
      playlistPathMode: 'playlist-relative',
      syncedLayoutMode: 'self-contained',
      syncedPlaylistPathMode: 'playlist-relative',
      sources: [],
      legacySources: [],
      legacyTargetDir: null,
      checkedIds: [],
      pendingDeletion: [],
      pendingPlan: false,
      targetDeviceId: null,
      pendingPlanDeviceId: null,
      pendingPlanChecked: false,
      targetRevision: 0,
      deviceFilePaths: [],
      scanning: false,

      setTargetDir: (dir) => set(state => ({
        targetDir: dir,
        pendingPlan: false,
        pendingPlanDeviceId: null,
        pendingPlanChecked: false,
        targetRevision: state.targetRevision + 1,
      })),
      setLayoutMode: (layoutMode) => set({ layoutMode }),
      setPlaylistPathMode: (playlistPathMode) => set({ playlistPathMode }),
      // The synced* pair describes how the device is laid out and always follows
      // the manifest. The plain pair is the user's desired layout and is only
      // adopted when the manifest states one; otherwise the choice survives the
      // attach and the resulting mismatch marks the configuration dirty.
      applyManifestConfiguration: (layoutMode, playlistPathMode, manifestDeclaresConfiguration) => set(
        manifestDeclaresConfiguration
          ? {
              layoutMode,
              playlistPathMode,
              syncedLayoutMode: layoutMode,
              syncedPlaylistPathMode: playlistPathMode,
            }
          : {
              syncedLayoutMode: layoutMode,
              syncedPlaylistPathMode: playlistPathMode,
            },
      ),
      markConfigurationSynced: (syncedLayoutMode, syncedPlaylistPathMode) => set({
        syncedLayoutMode,
        syncedPlaylistPathMode,
      }),

      addSource: (source) =>
        set((s) => {
          const owner = deviceSyncOwnerKey(s.sources);
          const key = deviceSyncSourceKey(source);
          if (!source.serverIndexKey || (owner && owner !== source.serverIndexKey)) return s;
          return {
            sources: s.sources.some((x) => deviceSyncSourceKey(x) === key)
              ? s.sources
              : withPlaylistPathIds([...s.sources, source]),
          };
        }),

      removeSource: (id) =>
        set((s) => ({
          sources: s.sources.filter((x) => deviceSyncSourceKey(x) !== id),
          checkedIds: s.checkedIds.filter((x) => x !== id),
          pendingDeletion: s.pendingDeletion.filter((x) => x !== id),
        })),

      clearSources: () => set({ sources: [], checkedIds: [], pendingDeletion: [] }),

      // Source keys embed the owner, so re-owning the sources has to carry the
      // selection and the pending deletions across to their new keys — dropping
      // them would silently cancel a delete the user already confirmed.
      reassignSourceOwner: (nextOwnerServerIndexKey) => set(state => {
        const rekeyed = new Map<string, string>();
        const sources = state.sources.map(source => {
          const next = { ...source, serverIndexKey: nextOwnerServerIndexKey };
          rekeyed.set(deviceSyncSourceKey(source), deviceSyncSourceKey(next));
          return next;
        });
        return {
          sources: withPlaylistPathIds(sources),
          checkedIds: state.checkedIds.map(key => rekeyed.get(key) ?? key),
          pendingDeletion: state.pendingDeletion.map(key => rekeyed.get(key) ?? key),
        };
      }),
      setLegacySources: (legacySources, legacyTargetDir = null) => set({ legacySources, legacyTargetDir }),
      quarantineLegacySources: (legacyTargetDir, legacySources) => set(state => {
        const merged = new Map<string, LegacyDeviceSyncSource>();
        const existing = state.legacyTargetDir === legacyTargetDir ? state.legacySources : [];
        for (const source of [...existing, ...legacySources]) {
          merged.set(JSON.stringify([source.type, source.id]), source);
        }
        return {
          sources: [],
          checkedIds: [],
          pendingDeletion: [],
          legacySources: [...merged.values()],
          legacyTargetDir,
        };
      }),
      recoverLegacySources: (candidateOwner) => {
        const state = get();
        const recovery = prepareDeviceSyncLegacyRecovery({
          sources: state.sources,
          legacySources: state.legacySources,
          serverIndexKey: candidateOwner,
        });
        if (recovery.result !== 'recovered') return recovery.result;
        set({ sources: recovery.sources, legacySources: [], legacyTargetDir: null });
        return recovery.result;
      },
      discardLegacySources: () => set({ legacySources: [], legacyTargetDir: null }),

      toggleChecked: (id) =>
        set((s) => ({
          checkedIds: s.checkedIds.includes(id)
            ? s.checkedIds.filter((x) => x !== id)
            : [...s.checkedIds, id],
        })),

      setCheckedIds: (ids) => set({ checkedIds: ids }),

      markForDeletion: (ids) =>
        set((s) => ({
          pendingDeletion: [...new Set([...s.pendingDeletion, ...ids])],
          checkedIds: s.checkedIds.filter((x) => !ids.includes(x)),
        })),

      unmarkDeletion: (id) =>
        set((s) => ({
          pendingDeletion: s.pendingDeletion.filter((x) => x !== id),
        })),

      clearPendingDeletion: () => set({ pendingDeletion: [] }),
      setPendingPlan: (pendingPlan) => set({ pendingPlan }),
      setTargetDeviceId: (targetDeviceId) => set({ targetDeviceId }),
      setPendingPlanDeviceId: (pendingPlanDeviceId) => set({ pendingPlanDeviceId }),
      setPendingPlanChecked: (pendingPlanChecked) => set({ pendingPlanChecked }),

      removeSources: (ids) =>
        set((s) => ({
          sources: s.sources.filter((x) => !ids.includes(deviceSyncSourceKey(x))),
          checkedIds: s.checkedIds.filter((x) => !ids.includes(x)),
          pendingDeletion: s.pendingDeletion.filter((x) => !ids.includes(x)),
        })),

      setDeviceFilePaths: (paths) => set({ deviceFilePaths: paths }),
      setScanning: (v) => set({ scanning: v }),
    }),
    {
      name: 'psysonic_device_sync',
      storage: createNavidromeCanonicalMigrationAwareJSONStorage(),
      version: 4,
      migrate: (persisted) => migrateDeviceSyncPersistedState(persisted) as DeviceSyncState,
      partialize: (s) => ({
        targetDir: s.targetDir,
        layoutMode: s.layoutMode,
        playlistPathMode: s.playlistPathMode,
        syncedLayoutMode: s.syncedLayoutMode,
        syncedPlaylistPathMode: s.syncedPlaylistPathMode,
        sources: s.sources,
        legacySources: s.legacySources,
        legacyTargetDir: s.legacyTargetDir,
        pendingDeletion: s.pendingDeletion,
        targetDeviceId: s.targetDeviceId,
      }),
    }
  )
);
