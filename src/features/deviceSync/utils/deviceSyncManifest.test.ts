import { beforeEach, describe, expect, it } from 'vitest';
import { invokeMock, onInvoke } from '@/test/mocks/tauri';
import { canonicalNavidromeId } from '@/lib/server/navidromeCanonicalId';
import {
  NAVIDROME_CANONICAL_BOOTSTRAP_LOCK_KEY,
  NAVIDROME_CANONICAL_MIGRATION_CHECKPOINT_KEY,
} from '@/lib/server/navidromeCanonicalCheckpointStatus';
import { makeAuthState, makeServer } from '@/test/helpers/factories';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { useAuthStore } from '@/store/authStore';
import { writeDeviceSyncManifest } from './deviceSyncManifest';

const owner = 'server.test';
const legacyId = '123e4567-e89b-12d3-a456-426614174000';
const source = { type: 'album' as const, id: legacyId, name: 'Album', serverIndexKey: owner };

describe('writeDeviceSyncManifest', () => {
  beforeEach(() => {
    localStorage.clear();
    resetAuthStore();
  });

  it('rejects delayed writes while the bootstrap lock is active', async () => {
    localStorage.setItem(NAVIDROME_CANONICAL_BOOTSTRAP_LOCK_KEY, '1');

    await expect(writeDeviceSyncManifest({
      destDir: '/device', ownerServerIndexKey: owner, sources: [source],
    })).rejects.toThrow('canonical_migration_active');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('normalizes and marks a manifest for a ready canonical owner', async () => {
    localStorage.setItem(NAVIDROME_CANONICAL_MIGRATION_CHECKPOINT_KEY, JSON.stringify({
      version: 1,
      servers: { [owner]: { canonicalVersion: 1, phase: 'ready', checkedVersion: '0.64.0' } },
    }));
    onInvoke('write_device_manifest', () => undefined);

    const sources = await writeDeviceSyncManifest({
      destDir: '/device', ownerServerIndexKey: owner, sources: [source],
    });

    expect(sources[0]?.id).toBe(canonicalNavidromeId(legacyId));
    expect(invokeMock).toHaveBeenCalledWith('write_device_manifest', {
      destDir: '/device',
      ownerServerIndexKey: owner,
      ownerServerProfileId: null,
      sources,
      canonicalIdVersion: 1,
    });
  });

  it('records the owning profile so a later address change can be followed', async () => {
    const server = makeServer({ id: 'profile-1', url: `https://${owner}` });
    useAuthStore.setState(makeAuthState({ servers: [server], activeServerId: server.id }));
    onInvoke('write_device_manifest', () => undefined);

    const sources = await writeDeviceSyncManifest({
      destDir: '/device', ownerServerIndexKey: owner, sources: [source],
    });

    expect(sources[0]?.serverProfileId).toBe('profile-1');
    expect(invokeMock).toHaveBeenCalledWith('write_device_manifest', expect.objectContaining({
      ownerServerProfileId: 'profile-1',
    }));
  });

  it('writes an explicitly owned empty manifest after the final source is removed', async () => {
    onInvoke('write_device_manifest', () => undefined);

    await expect(writeDeviceSyncManifest({
      destDir: '/device', ownerServerIndexKey: owner, sources: [],
    })).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith('write_device_manifest', {
      destDir: '/device',
      ownerServerIndexKey: owner,
      ownerServerProfileId: null,
      sources: [],
      canonicalIdVersion: null,
    });
  });
});
