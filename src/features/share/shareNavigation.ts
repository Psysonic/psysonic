import type { ServerShareState } from '@/features/share/store/shareStore';

type ShareState = { byServer: Record<string, ServerShareState> };

export function aggregateShareCount(state: ShareState, serverIds?: readonly string[]): number {
  const serverStates = serverIds
    ? serverIds.flatMap(serverId => state.byServer[serverId] ? [state.byServer[serverId]] : [])
    : Object.values(state.byServer);
  return serverStates.reduce((count, server) => count + server.shares.length, 0);
}
