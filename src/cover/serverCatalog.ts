import { serverHasExternalCatalog } from '@/lib/server/externalCatalog';
import { useAuthStore } from '@/store/authStore';
import type { CoverServerScope } from './types';

export function coverScopeHasExternalCatalog(scope: CoverServerScope, ownerServerId?: string): boolean {
  const state = useAuthStore.getState();
  const serverId = ownerServerId ?? (scope.kind === 'server' ? scope.serverId : state.activeServerId);
  return !!serverId && serverHasExternalCatalog(state, serverId);
}
