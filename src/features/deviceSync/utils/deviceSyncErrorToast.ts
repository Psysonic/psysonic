import type { TFunction } from 'i18next';
import { showToast } from '@/lib/dom/toast';

export function showDeviceSyncErrorToast(error: unknown, t: TFunction): void {
  const message = error instanceof Error ? error.message : String(error);
  let key = 'deviceSync.fetchError';

  if (message.includes('NOT_ENOUGH_SPACE')) {
    key = 'deviceSync.notEnoughSpace';
  } else if (message.includes('NOT_MOUNTED_VOLUME')) {
    key = 'deviceSync.notMountedVolume';
  } else if (
    message.includes('DEVICE_SYNC_DEVICE_CHANGED')
    || message.includes('DEVICE_SYNC_PENDING_PLAN_DEVICE_MISMATCH')
  ) {
    key = 'deviceSync.deviceChanged';
  } else if (message.includes('DEVICE_SYNC_CLEANUP_FAILED')) {
    key = 'deviceSync.cleanupFailed';
  } else if (
    message.includes('DEVICE_SYNC_PATH_COLLISION')
    || message.includes('DEVICE_SYNC_PATH_IDENTITY_COLLISION')
  ) {
    key = 'deviceSync.pathCollision';
  }

  showToast(t(key), key === 'deviceSync.fetchError' ? 3000 : 5000, 'error');
}
