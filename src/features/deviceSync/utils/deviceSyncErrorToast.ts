import type { TFunction } from 'i18next';
import { showToast } from '@/lib/dom/toast';

const PATH_COLLISION_CODE = 'DEVICE_SYNC_PATH_IDENTITY_COLLISION';

export function showDeviceSyncErrorToast(error: unknown, t: TFunction): void {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(PATH_COLLISION_CODE)) {
    // The occupied path is the only way to find the conflict, so it stays up longer.
    const path = message.split(`${PATH_COLLISION_CODE}:`)[1]?.trim() ?? '';
    showToast(t('deviceSync.pathCollision', { path }), 10000, 'error');
    return;
  }
  let key = 'deviceSync.fetchError';

  if (message.includes('DEVICE_SYNC_SERVER_UNRESOLVED')
    || message.includes('DEVICE_SYNC_SERVER_OWNER_MISMATCH')) {
    key = 'deviceSync.serverUnresolved';
  } else if (message.includes('NOT_ENOUGH_SPACE')) {
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
  }

  showToast(t(key), key === 'deviceSync.fetchError' ? 3000 : 5000, 'error');
}
