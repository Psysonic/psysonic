import { useSyncExternalStore } from 'react';
import {
  isDevOfflineBrowseForced,
  useDevOfflineBrowseStore,
} from '@/store/devOfflineBrowseStore';
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus';
import {
  getConnectionStatus,
  isActiveServerReachable,
  subscribeConnectionStatus,
} from '@/lib/network/activeServerReachability';
import { isNavigatorOfflineHint } from '@/lib/network/navigatorOnlineHint';

/** True when browse/detail pages should use local-bytes-only data sources. */
export function isOfflineBrowseActive(): boolean {
  if (isDevOfflineBrowseForced()) return true;
  if (isNavigatorOfflineHint()) return true;
  return !isActiveServerReachable();
}

/**
 * Reactive offline-browse flag for React trees. Re-renders when the DEV toggle,
 * browser online state, or active-server connection status changes.
 */
export function useOfflineBrowseActive(): boolean {
  const devForceOffline = useDevOfflineBrowseStore(s => s.forceOffline);
  // Shared status — all hook instances stay in sync after manual retry.
  useConnectionStatus();

  if (import.meta.env.DEV && devForceOffline) return true;
  if (isNavigatorOfflineHint()) return true;
  return !isActiveServerReachable();
}

/**
 * The same flag without starting a server probe of its own: it only follows the shared
 * connection status. For widgets that are always mounted inside the app shell (which runs the
 * probing `useConnectionStatus`), so they do not add a probe on mount and every 120 s each.
 */
export function useOfflineBrowseStatus(): boolean {
  const devForceOffline = useDevOfflineBrowseStore(s => s.forceOffline);
  useSyncExternalStore(subscribeConnectionStatus, getConnectionStatus, getConnectionStatus);

  if (import.meta.env.DEV && devForceOffline) return true;
  if (isNavigatorOfflineHint()) return true;
  return !isActiveServerReachable();
}
