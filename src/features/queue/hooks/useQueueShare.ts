import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QueueItemRef } from '@/lib/media/trackTypes';
import type { ServerProfile } from '@/store/authStoreTypes';
import { queueTrackIdsForServerProfile } from '@/features/playback';
import type { OutboundShareRequest } from '@/features/share';
import { encodeSharePayload } from '@/lib/share/shareLink';
import { serverShareBaseUrl } from '@/lib/server/serverEndpoint';
import { copyTextToClipboard } from '@/lib/server/serverMagicString';
import { serverListDisplayLabel } from '@/lib/server/serverDisplayName';
import { findServerByIdOrIndexKey } from '@/lib/server/serverLookup';
import { showToast } from '@/lib/dom/toast';
import { useUnavailableServerIds } from '@/lib/network/serverReachability';
import type { ServerChoiceOption } from '@/ui/ServerChoiceList';

interface Options {
  queueItems: QueueItemRef[];
  servers: ServerProfile[];
  activeServerId: string | null;
  publicShareQueueActive: boolean;
  navidromePublicSharePageUrl: string | null;
}

export interface QueueShareController {
  request: OutboundShareRequest;
  serverOptions: ServerChoiceOption[];
  defaultServerId: string;
  sharePickerOpen: boolean;
  handleCopy: () => Promise<void>;
  shareForServer: (serverId: string) => Promise<void>;
  requestForServer: (serverId: string) => OutboundShareRequest;
  closeSharePicker: () => void;
}

export function useQueueShare({
  queueItems,
  servers,
  activeServerId,
  publicShareQueueActive,
  navidromePublicSharePageUrl,
}: Options): QueueShareController {
  const { t } = useTranslation();
  const unavailableServerIds = useUnavailableServerIds();
  const [sharePickerOpen, setSharePickerOpen] = useState(false);
  const request = useMemo<OutboundShareRequest>(() => ({
    kind: 'queue',
    resourceIds: queueItems.map(item => item.trackId),
    serverIds: queueItems
      .map(item => findServerByIdOrIndexKey(item.serverId)?.id ?? item.serverId)
      .map(id => id ?? ''),
    originalUrl: publicShareQueueActive ? navidromePublicSharePageUrl : undefined,
    originalOnly: publicShareQueueActive,
  }), [navidromePublicSharePageUrl, publicShareQueueActive, queueItems]);
  const serverOptions = useMemo<ServerChoiceOption[]>(() => servers
    .filter(server => queueTrackIdsForServerProfile(queueItems, server.id).length > 0)
    .map(server => {
      const label = serverListDisplayLabel(server, servers);
      return {
        id: server.id,
        label,
        warning: unavailableServerIds.has(server.id)
          ? t('connection.offlineSubtitle', { server: label })
          : undefined,
      };
    }), [queueItems, servers, t, unavailableServerIds]);
  const defaultServerId = activeServerId && serverOptions.some(server => server.id === activeServerId)
    ? activeServerId
    : serverOptions[0]?.id ?? '';

  const copyForServer = async (serverId: string) => {
    const ids = queueTrackIdsForServerProfile(queueItems, serverId);
    if (ids.length === 0) {
      showToast(t('queue.shareQueueEmpty'), 3000, 'info');
      return;
    }
    const server = servers.find(candidate => candidate.id === serverId);
    if (!server) return;
    const srv = serverShareBaseUrl(server);
    if (!srv) return;
    const copied = await copyTextToClipboard(encodeSharePayload({ srv, k: 'queue', ids }));
    showToast(
      copied ? t('contextMenu.shareCopied') : t('contextMenu.shareCopyFailed'),
      copied ? 3000 : 4000,
      copied ? 'info' : 'error',
    );
  };

  const handleCopy = async () => {
    if (publicShareQueueActive) {
      const pageUrl = navidromePublicSharePageUrl?.trim();
      if (!pageUrl) {
        showToast(t('queue.shareNavidromePublicMissing'), 4000, 'error');
        return;
      }
      const copied = await copyTextToClipboard(pageUrl);
      showToast(
        copied ? t('contextMenu.shareCopied') : t('contextMenu.shareCopyFailed'),
        copied ? 3000 : 4000,
        copied ? 'info' : 'error',
      );
      return;
    }
    if (serverOptions.length === 0) {
      showToast(t('queue.shareQueueEmpty'), 3000, 'info');
      return;
    }
    if (serverOptions.length > 1) {
      setSharePickerOpen(open => !open);
      return;
    }
    await copyForServer(serverOptions[0]!.id);
  };

  const shareForServer = async (serverId: string) => {
    try {
      if (serverOptions.some(server => server.id === serverId)) await copyForServer(serverId);
    } finally {
      setSharePickerOpen(false);
    }
  };

  const requestForServer = (serverId: string): OutboundShareRequest => {
    const resourceIds = queueTrackIdsForServerProfile(queueItems, serverId);
    return {
      kind: 'queue',
      resourceIds,
      serverIds: resourceIds.map(() => serverId),
    };
  };

  return {
    request,
    serverOptions,
    defaultServerId,
    sharePickerOpen,
    handleCopy,
    shareForServer,
    requestForServer,
    closeSharePicker: () => setSharePickerOpen(false),
  };
}
