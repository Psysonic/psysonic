import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showToast } from '@/lib/dom/toast';
import { showDeviceSyncErrorToast } from './deviceSyncErrorToast';

vi.mock('@/lib/dom/toast', () => ({ showToast: vi.fn() }));

const t = ((key: string) => key) as never;

beforeEach(() => {
  vi.mocked(showToast).mockClear();
});

describe('showDeviceSyncErrorToast', () => {
  it.each([
    ['NOT_ENOUGH_SPACE:42', 'deviceSync.notEnoughSpace'],
    ['NOT_MOUNTED_VOLUME', 'deviceSync.notMountedVolume'],
    ['write failed; DEVICE_SYNC_DEVICE_CHANGED', 'deviceSync.deviceChanged'],
    ['DEVICE_SYNC_PENDING_PLAN_DEVICE_MISMATCH', 'deviceSync.deviceChanged'],
    ['DEVICE_SYNC_CLEANUP_FAILED', 'deviceSync.cleanupFailed'],
    ['DEVICE_SYNC_PATH_COLLISION:Artist/Album/song.flac', 'deviceSync.pathCollision'],
    ['DEVICE_SYNC_PATH_IDENTITY_COLLISION:artist/album/song.flac', 'deviceSync.pathCollision'],
  ])('maps %s to %s', (message, key) => {
    showDeviceSyncErrorToast(new Error(message), t);

    expect(showToast).toHaveBeenCalledWith(key, 5000, 'error');
  });

  it('keeps unexpected failures on the generic fallback', () => {
    showDeviceSyncErrorToast('network failed', t);

    expect(showToast).toHaveBeenCalledWith('deviceSync.fetchError', 3000, 'error');
  });
});
