import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import type { TFunction } from 'i18next';
import {
  deviceSyncManifestImport,
  deviceSyncLegacySourcesFromManifest,
  useDeviceSyncStore,
  type DeviceSyncManifest,
} from '@/features/deviceSync/store/deviceSyncStore';
import { showToast } from '@/lib/dom/toast';
import {
  deviceSyncDeviceId,
  inspectDeviceSyncTarget,
  markLocalSyncTarget,
  pendingDeviceSyncPlanDeviceId,
} from '@/lib/api/syncfs';
import { useConfirmModalStore } from '@/store/confirmModalStore';

export interface RunDeviceSyncChooseFolderDeps {
  t: TFunction;
  setTargetDir: (dir: string) => void;
  scanDevice: () => Promise<void>;
}

/**
 * A folder on the system disk is refused until the user confirms it: the
 * unmounted-device guard exists so a sync never fills the system disk through
 * the mount point of an unplugged stick. Returns whether the folder is usable.
 */
async function confirmLocalTarget(dir: string, t: TFunction): Promise<boolean> {
  try {
    const target = await inspectDeviceSyncTarget({ destDir: dir });
    if (!target.exists) return false;
    if (target.onMountedVolume || target.localTarget) return true;
    const confirmed = await useConfirmModalStore.getState().request({
      title: t('deviceSync.localTargetTitle'),
      message: t('deviceSync.localTargetConfirm', { path: dir }),
      confirmLabel: t('deviceSync.localTargetUse'),
      cancelLabel: t('common.cancel'),
    });
    if (!confirmed) return false;
    await markLocalSyncTarget({ destDir: dir });
    return true;
  } catch {
    showToast(t('deviceSync.localTargetInvalid'), 4000, 'error');
    return false;
  }
}

export async function runDeviceSyncChooseFolder(deps: RunDeviceSyncChooseFolderDeps): Promise<void> {
  const { t, setTargetDir, scanDevice } = deps;
  const sel = await openDialog({ directory: true, multiple: false, title: t('deviceSync.chooseFolder') });
  if (!sel) return;

  const dir = sel as string;
  if (!(await confirmLocalTarget(dir, t))) return;
  setTargetDir(dir);
  const target = await inspectDeviceSyncTarget({ destDir: dir }).catch(() => null);
  useDeviceSyncStore.getState().setTargetIsLocal(target?.localTarget === true);
  useDeviceSyncStore.getState().setPendingPlanChecked(false);
  // If the device has a psysonic-sync.json, always import it — replacing any
  // sources from a previous device so switching sticks works correctly.
  try {
    const manifest = await invoke<DeviceSyncManifest | null>(
      'read_device_manifest', { destDir: dir }
    );
    if (useDeviceSyncStore.getState().targetDir !== dir) return;
    const deviceId = await deviceSyncDeviceId({ destDir: dir });
    const pendingPlanDeviceId = await pendingDeviceSyncPlanDeviceId({ destDir: dir });
    if (useDeviceSyncStore.getState().targetDir !== dir) return;
    const pendingPlan = pendingPlanDeviceId !== null;
    useDeviceSyncStore.getState().setPendingPlan(pendingPlan);
    useDeviceSyncStore.getState().setPendingPlanDeviceId(pendingPlanDeviceId);
    if (!pendingPlan || useDeviceSyncStore.getState().targetDeviceId === null) {
      useDeviceSyncStore.getState().setTargetDeviceId(deviceId);
    }
    useDeviceSyncStore.getState().setPendingPlanChecked(true);
    if (pendingPlan) return;
    const legacySources = deviceSyncLegacySourcesFromManifest(manifest);
    if (legacySources.length > 0) {
      useDeviceSyncStore.getState().quarantineLegacySources(dir, legacySources);
    }
    const manifestImport = deviceSyncManifestImport(manifest);
    if (manifestImport) {
      const store = useDeviceSyncStore.getState();
      store.clearSources();
      store.applyManifestConfiguration(
        manifestImport.layoutMode,
        manifestImport.playlistPathMode,
        manifestImport.declaresConfiguration,
        manifestImport.transcode,
      );
      manifestImport.sources.forEach(s => useDeviceSyncStore.getState().addSource(s));
      showToast(t('deviceSync.manifestImported', { count: manifestImport.sources.length }), 4000, 'info');
    }
  } catch { /* no manifest, that's fine */ }
  // Trigger a device scan after folder change
  setTimeout(() => scanDevice(), 100);
}
