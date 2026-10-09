import { renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { invokeMock, onInvoke } from '@/test/mocks/tauri';
import {
  deviceSyncSourceKey,
  useDeviceSyncStore,
  type DeviceSyncSource,
} from '@/features/deviceSync/store/deviceSyncStore';
import { useDeviceSyncDeviceScan } from './useDeviceSyncDeviceScan';

describe('useDeviceSyncDeviceScan pending plan recovery', () => {
  beforeEach(() => {
    useDeviceSyncStore.setState({
      targetDir: '/device',
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
    });
  });

  it('preserves the desired local state while an active native plan exists', async () => {
    const desired: DeviceSyncSource = {
      type: 'playlist', id: 'desired', name: 'Desired', serverIndexKey: 'server.test',
    };
    const committed: DeviceSyncSource = {
      type: 'playlist', id: 'committed', name: 'Committed', serverIndexKey: 'server.test',
    };
    const deletionKey = deviceSyncSourceKey(desired);
    useDeviceSyncStore.setState({
      sources: [desired],
      pendingDeletion: [deletionKey],
      targetDeviceId: 'device-1',
    });
    onInvoke('list_device_dir_files', () => []);
    onInvoke('read_device_manifest', () => ({
      version: 4,
      schema: 'fixed-v2',
      ownerServerIndexKey: 'server.test',
      sources: [committed],
      layoutMode: 'shared-album-tree',
      playlistPathMode: 'device-rooted',
      files: [],
      playlists: [],
    }));
    onInvoke('pending_device_sync_plan_device_id', () => 'device-1');
    onInvoke('device_sync_device_id', () => 'device-1');

    renderHook(() => useDeviceSyncDeviceScan(
      '/device',
      1,
      true,
      ((key: string) => key) as TFunction,
    ), { wrapper: StrictMode });

    await waitFor(() => expect(useDeviceSyncStore.getState().pendingPlan).toBe(true));
    expect(useDeviceSyncStore.getState().sources).toEqual([desired]);
    expect(useDeviceSyncStore.getState().pendingDeletion).toEqual([deletionKey]);
    expect(useDeviceSyncStore.getState().pendingPlanDeviceId).toBe('device-1');
    expect(invokeMock).not.toHaveBeenCalledWith('write_device_manifest', expect.anything());
  });
});

describe('useDeviceSyncDeviceScan legacy template detection', () => {
  const source: DeviceSyncSource = {
    type: 'album', id: 'album-1', name: 'Album', serverIndexKey: 'server.test',
  };

  beforeEach(() => {
    useDeviceSyncStore.setState({
      targetDir: '/device',
      sources: [source],
      legacySources: [],
      legacyTargetDir: null,
      pendingDeletion: [],
      pendingPlan: false,
      targetDeviceId: 'device-1',
      pendingPlanDeviceId: null,
      pendingPlanChecked: false,
      deviceHasLegacyTemplate: false,
    });
    onInvoke('list_device_dir_files', () => []);
    onInvoke('pending_device_sync_plan_device_id', () => null);
    onInvoke('device_sync_device_id', () => 'device-1');
  });

  function scan() {
    renderHook(() => useDeviceSyncDeviceScan(
      '/device',
      1,
      true,
      ((key: string) => key) as TFunction,
    ));
  }

  it('flags a device synced with a custom file name template', async () => {
    onInvoke('read_device_manifest', () => ({
      version: 1,
      filenameTemplate: '{artist}/{album}/{title}',
      sources: [source],
    }));
    scan();
    await waitFor(() => expect(useDeviceSyncStore.getState().deviceHasLegacyTemplate).toBe(true));
  });

  it('leaves a device on the fixed scheme unflagged', async () => {
    useDeviceSyncStore.setState({ deviceHasLegacyTemplate: true });
    onInvoke('read_device_manifest', () => ({
      version: 4,
      schema: 'fixed-v2',
      ownerServerIndexKey: 'server.test',
      sources: [source],
      files: [],
      playlists: [],
    }));
    scan();
    await waitFor(() => expect(useDeviceSyncStore.getState().pendingPlanChecked).toBe(true));
    expect(useDeviceSyncStore.getState().deviceHasLegacyTemplate).toBe(false);
  });
});
