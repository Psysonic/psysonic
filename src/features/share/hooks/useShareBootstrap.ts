import { useEffect, useMemo } from 'react';
import { profileProbeFingerprint } from '@/lib/server/serverProbeFingerprint';
import { useAuthStore } from '@/store/authStore';
import { useShareStore } from '@/features/share/store/shareStore';
import { useShareSettingsStore } from '@/features/share/store/shareSettingsStore';

const SHARE_BOOTSTRAP_IDLE_TIMEOUT_MS = 1_500;

/** Deferred authenticated share discovery. Mount from the app shell after routing is ready. */
export function useShareBootstrap(): void {
  const isLoggedIn = useAuthStore(state => state.isLoggedIn);
  const servers = useAuthStore(state => state.servers);
  const activeServerId = useAuthStore(state => state.activeServerId);
  const libraryBrowseServerIds = useAuthStore(state => state.libraryBrowseServerIds);
  const identities = useAuthStore(state => state.subsonicServerIdentityByServer);
  const navidromeSharingEnabled = useShareSettingsStore(state => state.navidromeSharingEnabled);
  const profileKey = useMemo(
    () => servers.map(server => {
      const identity = identities[server.id];
      return `${server.id}:${profileProbeFingerprint(server)}:${identity?.type ?? ''}:${identity?.serverVersion ?? ''}`;
    }).join('\u0001'),
    [identities, servers],
  );
  const browseScopeKey = `${activeServerId ?? ''}\u0001${libraryBrowseServerIds.join('\u0001')}`;

  useEffect(() => {
    if (!navidromeSharingEnabled) {
      useShareStore.getState().reconcileProfiles([]);
      return;
    }
    useShareStore.getState().reconcileProfiles(servers);
    if (!isLoggedIn || servers.length === 0) return;

    let cancelled = false;
    const refresh = () => {
      if (!cancelled) void useShareStore.getState().refreshAll();
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(refresh, { timeout: SHARE_BOOTSTRAP_IDLE_TIMEOUT_MS });
    } else {
      window.setTimeout(refresh, 0);
    }
    return () => {
      cancelled = true;
    };
  }, [browseScopeKey, isLoggedIn, navidromeSharingEnabled, profileKey, servers]);
}
