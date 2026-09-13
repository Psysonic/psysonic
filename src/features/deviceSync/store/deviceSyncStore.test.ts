import { beforeEach, describe, expect, it } from 'vitest';
import {
  deviceSyncLegacySourcesFromManifest,
  deviceSyncManifestImport,
  deviceSyncOwnerKey,
  deviceSyncSourceKey,
  deviceSyncSourcesFromManifest,
  deviceSyncOwnerRelocation,
  deviceSyncUnresolvedOwnerKey,
  migrateDeviceSyncPersistedState,
  useDeviceSyncStore,
  type DeviceSyncSource,
} from './deviceSyncStore';
import { canonicalNavidromeId } from '@/lib/server/navidromeCanonicalId';
import { NAVIDROME_CANONICAL_MIGRATION_CHECKPOINT_KEY } from '@/lib/server/navidromeCanonicalCheckpointStatus';
import { useAuthStore } from '@/store/authStore';
import { resetAuthStore } from '@/test/helpers/storeReset';

const sourceA: DeviceSyncSource = {
  type: 'album',
  id: 'shared-id',
  name: 'Album A',
  serverIndexKey: 'server-a.test',
};

const sourceB: DeviceSyncSource = {
  ...sourceA,
  name: 'Album B',
  serverIndexKey: 'server-b.test',
};

describe('deviceSyncStore ownership', () => {
  beforeEach(() => {
    localStorage.clear();
    // Cases below seed server profiles; without this the next case inherits
    // them and its owner resolution silently changes meaning.
    resetAuthStore();
    useDeviceSyncStore.setState({
      targetDir: null,
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

  it('preserves the device binding while a changed mount path is rechecked', () => {
    useDeviceSyncStore.setState({
      targetDir: '/old-mount',
      targetDeviceId: 'device-1',
      pendingPlan: true,
      pendingPlanDeviceId: 'device-1',
      pendingPlanChecked: true,
      targetRevision: 4,
    });

    useDeviceSyncStore.getState().setTargetDir('/new-mount');

    expect(useDeviceSyncStore.getState()).toMatchObject({
      targetDir: '/new-mount',
      targetDeviceId: 'device-1',
      pendingPlan: false,
      pendingPlanDeviceId: null,
      pendingPlanChecked: false,
      targetRevision: 5,
    });
  });

  it('qualifies colliding raw IDs by server and source type', () => {
    expect(deviceSyncSourceKey(sourceA)).not.toBe(deviceSyncSourceKey(sourceB));
    expect(deviceSyncSourceKey(sourceA)).not.toBe(deviceSyncSourceKey({
      ...sourceA,
      type: 'playlist',
    }));
  });

  it('keeps one durable owner per device configuration', () => {
    useDeviceSyncStore.getState().addSource(sourceA);
    useDeviceSyncStore.getState().addSource(sourceB);

    expect(useDeviceSyncStore.getState().sources).toEqual([sourceA]);
    expect(deviceSyncOwnerKey(useDeviceSyncStore.getState().sources)).toBe(sourceA.serverIndexKey);
  });

  it('imports only owner-qualified manifests with a matching manifest owner', () => {
    expect(deviceSyncSourcesFromManifest({
      version: 3,
      schema: 'fixed-v1',
      ownerServerIndexKey: sourceA.serverIndexKey,
      sources: [sourceA],
    })).toEqual([sourceA]);

    expect(deviceSyncSourcesFromManifest({
      version: 2,
      sources: [{ type: 'album', id: 'legacy', name: 'Legacy' }],
    })).toEqual([]);

    const ownerlessManifest = {
      version: 2,
      sources: [{ type: 'album', id: 'legacy', name: 'Legacy' }],
    };
    expect(deviceSyncSourcesFromManifest(ownerlessManifest)).toEqual([]);
    expect(deviceSyncLegacySourcesFromManifest(ownerlessManifest)).toEqual([
      { type: 'album', id: 'legacy', name: 'Legacy' },
    ]);

    expect(deviceSyncSourcesFromManifest({
      version: 3,
      schema: 'fixed-v1',
      ownerServerIndexKey: sourceB.serverIndexKey,
      sources: [sourceA],
    })).toEqual([]);
  });

  it('recognizes an explicitly owned empty manifest', () => {
    expect(deviceSyncManifestImport({
      version: 3,
      schema: 'fixed-v1',
      ownerServerIndexKey: sourceA.serverIndexKey,
      sources: [],
    })).toEqual({
      ownerServerIndexKey: sourceA.serverIndexKey,
      sources: [],
      layoutMode: 'self-contained',
      playlistPathMode: 'playlist-relative',
      files: [],
      playlists: [],
      hasMaterializedPlan: false,
      declaresConfiguration: false,
    });
  });

  it('imports the shared layout and materialized ownership plan from v4', () => {
    const sourceKey = deviceSyncSourceKey(sourceA);
    expect(deviceSyncManifestImport({
      version: 4,
      schema: 'fixed-v2',
      ownerServerIndexKey: sourceA.serverIndexKey,
      sources: [sourceA],
      layoutMode: 'shared-album-tree',
      playlistPathMode: 'device-rooted',
      files: [{
        trackId: 'track-1',
        relativePath: 'Artist/Album/01 - Song.flac',
        sourceKeys: [sourceKey],
        sizeBytes: 100,
      }],
      playlists: [],
    })).toEqual(expect.objectContaining({
      layoutMode: 'shared-album-tree',
      playlistPathMode: 'device-rooted',
      hasMaterializedPlan: true,
      declaresConfiguration: true,
    }));
  });

  it('keeps the chosen layout when a manifest states none of its own', () => {
    useDeviceSyncStore.getState().setLayoutMode('shared-album-tree');
    useDeviceSyncStore.getState().setPlaylistPathMode('device-rooted');

    const imported = deviceSyncManifestImport({
      version: 3,
      schema: 'fixed-v1',
      ownerServerIndexKey: sourceA.serverIndexKey,
      sources: [sourceA],
    });
    useDeviceSyncStore.getState().applyManifestConfiguration(
      imported!.layoutMode,
      imported!.playlistPathMode,
      imported!.declaresConfiguration,
    );

    expect(useDeviceSyncStore.getState()).toMatchObject({
      layoutMode: 'shared-album-tree',
      playlistPathMode: 'device-rooted',
      // The device predates the layout modes, so it is laid out the old way —
      // the mismatch is what marks the configuration dirty.
      syncedLayoutMode: 'self-contained',
      syncedPlaylistPathMode: 'playlist-relative',
    });
  });

  it('adopts the layout a manifest states as both desired and synced', () => {
    useDeviceSyncStore.getState().setLayoutMode('self-contained');
    useDeviceSyncStore.getState().setPlaylistPathMode('playlist-relative');

    const imported = deviceSyncManifestImport({
      version: 4,
      schema: 'fixed-v2',
      ownerServerIndexKey: sourceA.serverIndexKey,
      sources: [sourceA],
      layoutMode: 'shared-album-tree',
      playlistPathMode: 'device-rooted',
      files: [],
      playlists: [],
    });
    useDeviceSyncStore.getState().applyManifestConfiguration(
      imported!.layoutMode,
      imported!.playlistPathMode,
      imported!.declaresConfiguration,
    );

    expect(useDeviceSyncStore.getState()).toMatchObject({
      layoutMode: 'shared-album-tree',
      playlistPathMode: 'device-rooted',
      syncedLayoutMode: 'shared-album-tree',
      syncedPlaylistPathMode: 'device-rooted',
    });
  });

  it('follows the owning profile to its new address and carries the plan with it', () => {
    // The device was written before the server moved, so its recorded address
    // is stale by definition — the profile id is what still identifies it.
    const movedServer = { id: 'profile-1', url: 'http://server-c.test', name: 'A' } as never;
    useAuthStore.setState({ servers: [movedServer] } as never);
    const staleKey = sourceA.serverIndexKey;
    const staleSourceKey = JSON.stringify([staleKey, 'album', sourceA.id]);

    const imported = deviceSyncManifestImport({
      version: 4,
      schema: 'fixed-v2',
      ownerServerIndexKey: staleKey,
      ownerServerProfileId: 'profile-1',
      sources: [sourceA],
      layoutMode: 'shared-album-tree',
      playlistPathMode: 'device-rooted',
      files: [{
        trackId: 'track-1',
        relativePath: 'Artist/Album/01 - Song.flac',
        sourceKeys: [staleSourceKey],
        sizeBytes: 100,
      }],
      playlists: [{ sourceKey: staleSourceKey, relativePath: 'Playlists/Mix/Mix.m3u8' }],
    });

    const movedSourceKey = JSON.stringify(['server-c.test', 'album', sourceA.id]);
    expect(imported?.ownerServerIndexKey).toBe('server-c.test');
    expect(imported?.sources).toEqual([
      { ...sourceA, serverIndexKey: 'server-c.test', serverProfileId: 'profile-1' },
    ]);
    // Without this the device's files look unclaimed and get downloaded again.
    expect(imported?.files[0]?.sourceKeys).toEqual([movedSourceKey]);
    expect(imported?.playlists[0]?.sourceKey).toBe(movedSourceKey);
  });

  it('keeps the recorded address when the owning profile is gone', () => {
    useAuthStore.setState({ servers: [] } as never);

    const imported = deviceSyncManifestImport({
      version: 3,
      schema: 'fixed-v1',
      ownerServerIndexKey: sourceA.serverIndexKey,
      ownerServerProfileId: 'profile-1',
      sources: [sourceA],
    });

    expect(imported?.ownerServerIndexKey).toBe(sourceA.serverIndexKey);
  });

  it('reports a relocation only while the profile identity is unambiguous', () => {
    const movedServer = { id: 'profile-1', url: 'http://server-c.test', name: 'A' } as never;
    const owned = { ...sourceA, serverProfileId: 'profile-1' };

    expect(deviceSyncOwnerRelocation([owned], [movedServer]))
      .toEqual({ from: sourceA.serverIndexKey, to: 'server-c.test' });
    // Already current.
    expect(deviceSyncOwnerRelocation(
      [{ ...owned, serverIndexKey: 'server-c.test' }], [movedServer],
    )).toBeNull();
    // Recorded before the profile id existed — only manual repair can fix this.
    expect(deviceSyncOwnerRelocation([sourceA], [movedServer])).toBeNull();
    // Profile no longer configured.
    expect(deviceSyncOwnerRelocation([owned], [])).toBeNull();
  });

  it('does not ask for a repair decision when the owner can simply relocate', () => {
    const movedServer = { id: 'profile-1', url: 'http://server-c.test', name: 'A' } as never;
    const owned = { ...sourceA, serverProfileId: 'profile-1' };

    expect(deviceSyncUnresolvedOwnerKey([owned], [movedServer])).toBeNull();
    expect(deviceSyncUnresolvedOwnerKey([sourceA], [movedServer])).toBe(sourceA.serverIndexKey);
  });

  it('reports an owner that no configured server resolves to', () => {
    const movedServer = { id: 'profile-1', url: 'http://server-a.test', name: 'A' } as never;
    const relocatedServer = { id: 'profile-1', url: 'http://server-c.test', name: 'A' } as never;

    expect(deviceSyncUnresolvedOwnerKey([sourceA], [movedServer])).toBeNull();
    expect(deviceSyncUnresolvedOwnerKey([sourceA], [relocatedServer])).toBe(sourceA.serverIndexKey);
    expect(deviceSyncUnresolvedOwnerKey([], [])).toBeNull();
  });

  it('carries the selection and pending deletions onto the new owner keys', () => {
    const previousKey = deviceSyncSourceKey(sourceA);
    useDeviceSyncStore.setState({
      sources: [sourceA],
      checkedIds: [previousKey],
      pendingDeletion: [previousKey],
    });

    useDeviceSyncStore.getState().reassignSourceOwner('server-c.test');

    const nextKey = deviceSyncSourceKey({ ...sourceA, serverIndexKey: 'server-c.test' });
    expect(nextKey).not.toBe(previousKey);
    expect(useDeviceSyncStore.getState()).toMatchObject({
      sources: [{ ...sourceA, serverIndexKey: 'server-c.test' }],
      checkedIds: [nextKey],
      pendingDeletion: [nextKey],
    });
  });

  it('rejects a non-empty owned manifest with malformed sources instead of clearing state', () => {
    expect(deviceSyncManifestImport({
      version: 3,
      schema: 'fixed-v1',
      ownerServerIndexKey: sourceA.serverIndexKey,
      sources: [{ type: 'future-type', id: 'future', name: 'Future' }],
    })).toBeNull();
  });

  it('rejects future and partially understood manifests without dropping entries', () => {
    expect(deviceSyncManifestImport({
      version: 5,
      schema: 'fixed-v2',
      ownerServerIndexKey: sourceA.serverIndexKey,
      sources: [sourceA],
    })).toBeNull();
    expect(deviceSyncLegacySourcesFromManifest({
      version: 2,
      sources: [
        { type: 'album', id: 'legacy', name: 'Legacy' },
        { type: 'future-type', id: 'future', name: 'Future' },
      ],
    })).toEqual([]);
  });

  it('preserves ownerless v0 selections until explicit recovery or discard', () => {
    const legacy = { type: 'album' as const, id: 'legacy', name: 'Legacy' };
    const migrated = migrateDeviceSyncPersistedState({ sources: [legacy] });
    expect(migrated.sources).toEqual([]);
    expect(migrated.legacySources).toEqual([legacy]);
    expect(migrated.legacyTargetDir).toBeNull();

    useDeviceSyncStore.setState(migrated);
    useDeviceSyncStore.getState().addSource(sourceA);

    expect(useDeviceSyncStore.getState().legacySources).toEqual([legacy]);
    expect(useDeviceSyncStore.getState().sources).toEqual([sourceA]);

    useDeviceSyncStore.getState().clearSources();
    expect(useDeviceSyncStore.getState().legacySources).toEqual([legacy]);
  });

  it('preserves pending deletion keys for crash-safe finalization retry', () => {
    const sourceKey = deviceSyncSourceKey(sourceA);
    const migrated = migrateDeviceSyncPersistedState({
      sources: [sourceA],
      pendingDeletion: [sourceKey, sourceKey, 42],
    });

    expect(migrated.pendingDeletion).toEqual([sourceKey]);
  });

  it('keeps quarantined legacy sources scoped to their originating device', () => {
    const sourceOne = { type: 'album' as const, id: 'one', name: 'One' };
    const sourceTwo = { type: 'album' as const, id: 'two', name: 'Two' };

    useDeviceSyncStore.getState().quarantineLegacySources('/device-a', [sourceOne]);
    useDeviceSyncStore.getState().quarantineLegacySources('/device-b', [sourceTwo]);

    expect(useDeviceSyncStore.getState().legacyTargetDir).toBe('/device-b');
    expect(useDeviceSyncStore.getState().legacySources).toEqual([sourceTwo]);
  });

  it('clears active sources when a different device enters legacy recovery', () => {
    const legacy = { type: 'album' as const, id: 'legacy', name: 'Legacy' };
    useDeviceSyncStore.setState({
      sources: [sourceA],
      checkedIds: [deviceSyncSourceKey(sourceA)],
      pendingDeletion: [deviceSyncSourceKey(sourceA)],
    });

    useDeviceSyncStore.getState().quarantineLegacySources('/device-b', [legacy]);

    expect(useDeviceSyncStore.getState()).toMatchObject({
      sources: [],
      checkedIds: [],
      pendingDeletion: [],
      legacySources: [legacy],
      legacyTargetDir: '/device-b',
    });
  });

  it('canonicalizes old manifest source IDs when the owner checkpoint is ready', () => {
    const legacyId = '123e4567-e89b-12d3-a456-426614174000';
    localStorage.setItem(NAVIDROME_CANONICAL_MIGRATION_CHECKPOINT_KEY, JSON.stringify({
      version: 1,
      servers: {
        [sourceA.serverIndexKey]: {
          canonicalVersion: 1,
          phase: 'ready',
          checkedVersion: '0.64.0',
        },
      },
    }));

    expect(deviceSyncSourcesFromManifest({
      version: 2,
      ownerServerIndexKey: sourceA.serverIndexKey,
      sources: [{ type: 'album', id: legacyId, name: 'Legacy' }],
    })).toEqual([{
      type: 'album',
      id: canonicalNavidromeId(legacyId),
      name: 'Legacy',
      serverIndexKey: sourceA.serverIndexKey,
    }]);
  });

  it('canonicalizes materialized manifest ownership when the checkpoint is ready', () => {
    const legacyTrackId = '123e4567-e89b-12d3-a456-426614174000';
    const legacyPlaylistId = '223e4567-e89b-12d3-a456-426614174000';
    localStorage.setItem(NAVIDROME_CANONICAL_MIGRATION_CHECKPOINT_KEY, JSON.stringify({
      version: 1,
      servers: {
        [sourceA.serverIndexKey]: {
          canonicalVersion: 1,
          phase: 'ready',
          checkedVersion: '0.64.0',
        },
      },
    }));
    const legacySourceKey = JSON.stringify([
      sourceA.serverIndexKey, 'playlist', legacyPlaylistId,
    ]);

    const imported = deviceSyncManifestImport({
      version: 4,
      schema: 'fixed-v2',
      ownerServerIndexKey: sourceA.serverIndexKey,
      sources: [{
        type: 'playlist', id: legacyPlaylistId, name: 'Mix', serverIndexKey: sourceA.serverIndexKey,
      }],
      files: [{
        trackId: legacyTrackId,
        relativePath: 'Artist/Album/01 - Song.flac',
        sourceKeys: [legacySourceKey],
        sizeBytes: 100,
      }],
      playlists: [{ sourceKey: legacySourceKey, relativePath: 'Playlists/Mix/Mix.m3u8' }],
    });
    const canonicalSourceKey = JSON.stringify([
      sourceA.serverIndexKey, 'playlist', canonicalNavidromeId(legacyPlaylistId),
    ]);

    expect(imported?.files[0]).toMatchObject({
      trackId: canonicalNavidromeId(legacyTrackId),
      sourceKeys: [canonicalSourceKey],
    });
    expect(imported?.playlists[0].sourceKey).toBe(canonicalSourceKey);
  });

  it('defers old manifest import while the owner canonical migration is pending', () => {
    localStorage.setItem(NAVIDROME_CANONICAL_MIGRATION_CHECKPOINT_KEY, JSON.stringify({
      version: 1,
      servers: {
        [sourceA.serverIndexKey]: {
          canonicalVersion: 1,
          phase: 'frontend',
          checkedVersion: null,
        },
      },
    }));

    expect(deviceSyncSourcesFromManifest({
      version: 2,
      ownerServerIndexKey: sourceA.serverIndexKey,
      sources: [{ type: 'album', id: 'legacy', name: 'Legacy' }],
    })).toEqual([]);
  });

  it('recovers ownerless sources only after explicit owner selection', () => {
    const legacyId = '123e4567-e89b-12d3-a456-426614174000';
    localStorage.setItem(NAVIDROME_CANONICAL_MIGRATION_CHECKPOINT_KEY, JSON.stringify({
      version: 1,
      servers: {
        [sourceA.serverIndexKey]: {
          canonicalVersion: 1,
          phase: 'ready',
          checkedVersion: '0.64.0',
        },
      },
    }));
    useDeviceSyncStore.getState().setLegacySources([
      { type: 'album', id: legacyId, name: 'Legacy' },
    ]);

    expect(useDeviceSyncStore.getState().recoverLegacySources(sourceA.serverIndexKey)).toBe('recovered');
    expect(useDeviceSyncStore.getState().legacySources).toEqual([]);
    expect(useDeviceSyncStore.getState().sources).toEqual([{
      type: 'album',
      id: canonicalNavidromeId(legacyId),
      name: 'Legacy',
      serverIndexKey: sourceA.serverIndexKey,
    }]);
  });

  it('persists playlist path discriminators during legacy recovery', () => {
    useDeviceSyncStore.getState().setLegacySources([
      { type: 'playlist', id: 'one', name: 'Road/Trip' },
      { type: 'playlist', id: 'two', name: 'Road:Trip' },
    ]);

    expect(useDeviceSyncStore.getState().recoverLegacySources(sourceA.serverIndexKey)).toBe('recovered');
    expect(useDeviceSyncStore.getState().sources).toEqual([
      {
        type: 'playlist',
        id: 'one',
        name: 'Road/Trip',
        serverIndexKey: sourceA.serverIndexKey,
        pathId: 'one',
      },
      {
        type: 'playlist',
        id: 'two',
        name: 'Road:Trip',
        serverIndexKey: sourceA.serverIndexKey,
        pathId: 'two',
      },
    ]);
  });

  it('refuses recovery while the selected owner checkpoint is pending', () => {
    localStorage.setItem(NAVIDROME_CANONICAL_MIGRATION_CHECKPOINT_KEY, JSON.stringify({
      version: 1,
      servers: {
        [sourceA.serverIndexKey]: {
          canonicalVersion: 1,
          phase: 'frontend',
          checkedVersion: null,
        },
      },
    }));
    useDeviceSyncStore.getState().setLegacySources([
      { type: 'album', id: 'legacy', name: 'Legacy' },
    ]);

    expect(useDeviceSyncStore.getState().recoverLegacySources(sourceA.serverIndexKey)).toBe('pending');
    expect(useDeviceSyncStore.getState().legacySources).toHaveLength(1);
    expect(useDeviceSyncStore.getState().sources).toEqual([]);
  });
});
