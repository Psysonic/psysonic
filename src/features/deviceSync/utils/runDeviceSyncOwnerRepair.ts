import { invoke } from '@tauri-apps/api/core';
import {
  deviceSyncManifestImport,
  useDeviceSyncStore,
  type DeviceSyncManifest,
} from '@/features/deviceSync/store/deviceSyncStore';
import { writeDeviceSyncManifest } from '@/features/deviceSync/utils/deviceSyncManifest';
import {
  repairedManifestFiles,
  repairedManifestPlaylists,
} from '@/features/deviceSync/utils/deviceSyncOwnerKeys';

export type DeviceSyncOwnerRepairResult =
  | 'repaired'
  | 'no-target'
  | 'manifest-unreadable'
  | 'write-failed';

/**
 * Re-owns the device's sources after its server moved to a different address.
 *
 * The manifest is rewritten first: the store is only re-owned once the device
 * agrees, otherwise the next attach would import the old owner straight back
 * and undo the repair. The materialized file and playlist plan is carried over
 * with its keys rewritten — dropping it would make the next sync re-download
 * everything that is already on the device.
 */
export async function runDeviceSyncOwnerRepair(args: {
  previousOwnerServerIndexKey: string;
  nextOwnerServerIndexKey: string;
}): Promise<DeviceSyncOwnerRepairResult> {
  const { previousOwnerServerIndexKey, nextOwnerServerIndexKey } = args;
  const before = useDeviceSyncStore.getState();
  const targetDir = before.targetDir;
  if (!targetDir) return 'no-target';

  let manifest: DeviceSyncManifest | null;
  try {
    manifest = await invoke<DeviceSyncManifest | null>('read_device_manifest', {
      destDir: targetDir,
    });
  } catch {
    return 'manifest-unreadable';
  }

  const imported = deviceSyncManifestImport(manifest);
  const sources = before.sources.map(source => ({
    ...source,
    serverIndexKey: nextOwnerServerIndexKey,
  }));

  try {
    await writeDeviceSyncManifest({
      destDir: targetDir,
      ownerServerIndexKey: nextOwnerServerIndexKey,
      sources,
      layoutMode: imported?.layoutMode ?? before.syncedLayoutMode,
      playlistPathMode: imported?.playlistPathMode ?? before.syncedPlaylistPathMode,
      files: imported?.hasMaterializedPlan
        ? repairedManifestFiles(
            imported.files, previousOwnerServerIndexKey, nextOwnerServerIndexKey,
          )
        : undefined,
      playlists: imported?.hasMaterializedPlan
        ? repairedManifestPlaylists(
            imported.playlists, previousOwnerServerIndexKey, nextOwnerServerIndexKey,
          )
        : undefined,
    });
  } catch {
    return 'write-failed';
  }

  const after = useDeviceSyncStore.getState();
  if (after.targetDir !== targetDir || after.sources !== before.sources) {
    // The device or the selection moved while the manifest was being written;
    // the store would no longer match what was just put on the device.
    return 'write-failed';
  }
  useDeviceSyncStore.getState().reassignSourceOwner(nextOwnerServerIndexKey);
  return 'repaired';
}
