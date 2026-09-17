import { useMemo } from 'react';
import type { QueueItemRef } from '@/lib/media/trackTypes';
import type { OutboundShareRequest } from '@/features/share';
import { findServerByIdOrIndexKey } from '@/lib/server/serverLookup';

interface Options {
  queueItems: QueueItemRef[];
  publicShareQueueActive: boolean;
  navidromePublicSharePageUrl: string | null;
}

export function useQueueShare({
  queueItems,
  publicShareQueueActive,
  navidromePublicSharePageUrl,
}: Options): OutboundShareRequest {
  return useMemo(() => ({
    kind: 'queue',
    resourceIds: queueItems.map(item => item.trackId),
    serverIds: queueItems
      .map(item => findServerByIdOrIndexKey(item.serverId)?.id ?? item.serverId)
      .map(id => id ?? ''),
    originalUrl: publicShareQueueActive ? navidromePublicSharePageUrl : undefined,
    originalOnly: publicShareQueueActive,
  }), [navidromePublicSharePageUrl, publicShareQueueActive, queueItems]);
}
