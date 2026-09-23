import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRemovableDrives, inspectDeviceSyncTarget } from '@/lib/api/syncfs';
import type { RemovableDrive } from '@/features/deviceSync/utils/deviceSyncHelpers';
import { useDeviceSyncStore } from '@/features/deviceSync/store/deviceSyncStore';

export interface DeviceSyncDrivesResult {
  drives: RemovableDrive[];
  drivesLoading: boolean;
  activeDrive: RemovableDrive | null;
  /** The target is usable: on a detected removable drive or a confirmed local folder. */
  driveDetected: boolean;
  targetIsLocal: boolean;
  refreshDrives: () => Promise<void>;
}

export function useDeviceSyncDrives(targetDir: string | null): DeviceSyncDrivesResult {
  const [drives, setDrives] = useState<RemovableDrive[]>([]);
  const [drivesLoading, setDrivesLoading] = useState(false);
  const targetIsLocal = useDeviceSyncStore(s => s.targetIsLocal);

  // A confirmed local folder stands in for a drive. Re-checked on every poll
  // so deleting the folder (or its marker) disables syncing to it again.
  const refreshLocalTarget = useCallback(async () => {
    const target = useDeviceSyncStore.getState().targetDir;
    let local = false;
    if (target) {
      try {
        local = (await inspectDeviceSyncTarget({ destDir: target })).localTarget;
      } catch {
        local = false;
      }
    }
    if (useDeviceSyncStore.getState().targetDir !== target) return;
    if (useDeviceSyncStore.getState().targetIsLocal !== local) {
      useDeviceSyncStore.getState().setTargetIsLocal(local);
    }
  }, []);

  const refreshDrives = useCallback(async () => {
    setDrivesLoading(true);
    try {
      const result = await getRemovableDrives();
      setDrives(result);
    } catch {
      setDrives([]);
    } finally {
      setDrivesLoading(false);
    }
    await refreshLocalTarget();
  }, [refreshLocalTarget]);

  useEffect(() => {
    void refreshLocalTarget();
  }, [targetDir, refreshLocalTarget]);

  // Fetch drives on mount, then poll every 5 seconds
  useEffect(() => {
    // React Compiler set-state-in-effect rule: state set from a timer/animation callback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshDrives();
    const interval = setInterval(refreshDrives, 5000);
    return () => clearInterval(interval);
  }, [refreshDrives]);

  // Detect if the current targetDir is on a detected removable drive
  const activeDrive = useMemo(() => {
    if (!targetDir) return null;
    return drives.find(d => targetDir.startsWith(d.mount_point)) ?? null;
  }, [targetDir, drives]);

  const driveDetected = activeDrive !== null || (targetDir !== null && targetIsLocal);

  return { drives, drivesLoading, activeDrive, driveDetected, targetIsLocal, refreshDrives };
}
