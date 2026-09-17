import type { ServerShareState } from '@/features/share/store/shareStore';

type ShareState = { byServer: Record<string, ServerShareState> };

export function selectAggregateShareCount(state: ShareState): number {
  return Object.values(state.byServer).reduce((count, server) => count + server.shares.length, 0);
}
