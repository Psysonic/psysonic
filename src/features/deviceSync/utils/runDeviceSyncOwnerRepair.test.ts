import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onInvoke } from '@/test/mocks/tauri';
import { makeAuthState, makeServer } from '@/test/helpers/factories';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { useAuthStore } from '@/store/authStore';
import { serverIndexKeyForProfile } from '@/lib/server/serverIndexKey';
import {
  deviceSyncSourceKey,
  useDeviceSyncStore,
  type DeviceSyncSource,
} from '@/features/deviceSync/store/deviceSyncStore';
import { runDeviceSyncOwnerRepair } from './runDeviceSyncOwnerRepair';
import { repairedManifestSourceKey } from './deviceSyncOwnerKeys';

const STALE_KEY = 'gone.test:4533';

describe('device sync owner repair', () => {
  beforeEach(() => {
    resetAuthStore();
    localStorage.clear();
    useDeviceSyncStore.setState({
      targetDir: null,
      layoutMode: 'self-contained',
      playlistPathMode: 'playlist-relative',
      syncedLayoutMode: 'self-contained',
      syncedPlaylistPathMode: 'playlist-relative',
      sources: [],
      checkedIds: [],
      pendingDeletion: [],
      legacySources: [],
      legacyTargetDir: null,
    });
  });

  it('rewrites only the keys owned by the outgoing server', () => {
    const owned = JSON.stringify([STALE_KEY, 'album', 'album-1']);
    const foreign = JSON.stringify(['other.test', 'album', 'album-1']);

    expect(repairedManifestSourceKey(owned, STALE_KEY, 'now.test'))
      .toBe(JSON.stringify(['now.test', 'album', 'album-1']));
    expect(repairedManifestSourceKey(foreign, STALE_KEY, 'now.test')).toBe(foreign);
    expect(repairedManifestSourceKey('not json', STALE_KEY, 'now.test')).toBe('not json');
    expect(repairedManifestSourceKey('[1,2,3]', STALE_KEY, 'now.test')).toBe('[1,2,3]');
  });

  it('re-owns the manifest plan before the store, carrying the file mapping over', async () => {
    const server = makeServer({ id: 'profile-1', url: 'https://now.test' });
    const nextKey = serverIndexKeyForProfile(server);
    useAuthStore.setState(makeAuthState({ servers: [server], activeServerId: server.id }));

    const source: DeviceSyncSource = {
      type: 'playlist', id: 'pl-1', name: 'Mix', serverIndexKey: STALE_KEY,
    };
    const staleSourceKey = deviceSyncSourceKey(source);
    useDeviceSyncStore.setState({
      targetDir: '/device',
      sources: [source],
      pendingDeletion: [staleSourceKey],
    });

    onInvoke('read_device_manifest', () => ({
      version: 4,
      schema: 'fixed-v2',
      ownerServerIndexKey: STALE_KEY,
      sources: [source],
      layoutMode: 'shared-album-tree',
      playlistPathMode: 'device-rooted',
      files: [{
        trackId: 'track-1',
        relativePath: 'Artist/Album/01 - Song.flac',
        sourceKeys: [staleSourceKey],
        sizeBytes: 100,
      }],
      playlists: [{ sourceKey: staleSourceKey, relativePath: 'Playlists/Mix/Mix.m3u8' }],
    }));

    let written: Record<string, unknown> | null = null;
    onInvoke('write_device_manifest', args => {
      written = args as Record<string, unknown>;
      return null;
    });

    await expect(runDeviceSyncOwnerRepair({
      previousOwnerServerIndexKey: STALE_KEY,
      nextOwnerServerIndexKey: nextKey,
    })).resolves.toBe('repaired');

    const nextSourceKey = deviceSyncSourceKey({ ...source, serverIndexKey: nextKey });
    expect(written).toMatchObject({
      destDir: '/device',
      ownerServerIndexKey: nextKey,
      layoutMode: 'shared-album-tree',
      playlistPathMode: 'device-rooted',
      files: [expect.objectContaining({ sourceKeys: [nextSourceKey] })],
      playlists: [expect.objectContaining({ sourceKey: nextSourceKey })],
    });
    expect(useDeviceSyncStore.getState().sources).toEqual([
      { ...source, serverIndexKey: nextKey },
    ]);
    expect(useDeviceSyncStore.getState().pendingDeletion).toEqual([nextSourceKey]);
  });

  it('leaves the store on the old owner when the device cannot be written', async () => {
    const server = makeServer({ id: 'profile-1', url: 'https://now.test' });
    const nextKey = serverIndexKeyForProfile(server);
    useAuthStore.setState(makeAuthState({ servers: [server], activeServerId: server.id }));

    const source: DeviceSyncSource = {
      type: 'album', id: 'album-1', name: 'Album', serverIndexKey: STALE_KEY,
    };
    useDeviceSyncStore.setState({ targetDir: '/device', sources: [source] });

    onInvoke('read_device_manifest', () => ({
      version: 3,
      schema: 'fixed-v1',
      ownerServerIndexKey: STALE_KEY,
      sources: [source],
    }));
    onInvoke('write_device_manifest', () => { throw new Error('device gone'); });

    await expect(runDeviceSyncOwnerRepair({
      previousOwnerServerIndexKey: STALE_KEY,
      nextOwnerServerIndexKey: nextKey,
    })).resolves.toBe('write-failed');

    // Re-owning the store alone would strand it: the next attach imports the
    // device's untouched manifest and puts the dead owner straight back.
    expect(useDeviceSyncStore.getState().sources).toEqual([source]);
  });

  it('refuses to repair without a chosen device folder', async () => {
    useDeviceSyncStore.setState({ targetDir: null });
    const readManifest = vi.fn();
    onInvoke('read_device_manifest', () => { readManifest(); return null; });

    await expect(runDeviceSyncOwnerRepair({
      previousOwnerServerIndexKey: STALE_KEY,
      nextOwnerServerIndexKey: 'now.test',
    })).resolves.toBe('no-target');
    expect(readManifest).not.toHaveBeenCalled();
  });
});
