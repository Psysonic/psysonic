import { useAuthStore } from '@/store/authStore';
import { useShareStore } from '@/features/share/store/shareStore';
import { useShareSettingsStore } from '@/features/share/store/shareSettingsStore';
import {
  resolveNavidromeShareAvailability,
  type ShareAvailabilityReason,
} from '@/features/share/shareAvailability';
import { copyEntityShareLink } from '@/lib/share/copyEntityShareLink';
import { encodeSharePayload, type EntityShareKind } from '@/lib/share/shareLink';
import { serverShareBaseUrl } from '@/lib/server/serverEndpoint';
import { copyTextToClipboard } from '@/lib/server/serverMagicString';
import { showToast } from '@/lib/dom/toast';
import { findServerByIdOrIndexKey } from '@/lib/server/serverLookup';
import type { TFunction } from 'i18next';

export type OutboundShareMethod = 'psysonic' | 'navidrome';

export interface OutboundShareRequest {
  kind: EntityShareKind | 'queue';
  resourceIds: readonly string[];
  serverIds: readonly string[];
  originalUrl?: string | null;
  originalOnly?: boolean;
}

export interface OutboundShareMethodModel {
  id: OutboundShareMethod;
  label: string;
  available: boolean;
  reason?: ShareAvailabilityReason;
}

export interface OutboundShareModel {
  methods: OutboundShareMethodModel[];
  share: (method: OutboundShareMethod) => Promise<boolean>;
}

function singleOwnerServerId(request: OutboundShareRequest): string | undefined {
  if (request.serverIds.length === 0 || request.serverIds.some(serverId => !serverId)) return undefined;
  const owners = [...new Set(request.serverIds
    .map(serverId => findServerByIdOrIndexKey(serverId)?.id ?? serverId))];
  return owners.length === 1 ? owners[0] : undefined;
}

function resolvePsysonicAvailability(request: OutboundShareRequest) {
  if (!request.resourceIds.some(Boolean)) return { available: false as const, reason: 'no_resources' as const };
  if (request.serverIds.length === 0 || request.serverIds.some(serverId => !serverId)) {
    return { available: false as const, reason: 'server_owner_unknown' as const };
  }
  const owners = new Set(request.serverIds.map(
    serverId => findServerByIdOrIndexKey(serverId)?.id ?? serverId,
  ));
  if (owners.size > 1) return { available: false as const, reason: 'multiple_servers' as const };
  const serverId = singleOwnerServerId(request);
  return serverId && useAuthStore.getState().servers.some(server => server.id === serverId)
    ? { available: true as const }
    : { available: false as const, reason: 'server_owner_unknown' as const };
}

export function outboundShareUnavailableHelp(
  reason: ShareAvailabilityReason | undefined,
  t: TFunction,
): string {
  switch (reason) {
    case 'composer_unsupported':
      return t('shared.reasonComposerUnsupported');
    case 'multiple_servers':
      return t('shared.reasonMultipleServers');
    case 'server_owner_unknown':
      return t('shared.reasonServerOwnerUnknown');
    case 'not_navidrome':
      return t('shared.reasonNotNavidrome');
    case 'identity_unknown':
      return t('shared.reasonIdentityUnknown');
    case 'version_too_old':
      return t('shared.reasonVersionTooOld');
    case 'sharing_disabled':
      return t('shared.reasonSharingDisabled');
    case 'server_unavailable':
      return t('shared.reasonServerUnavailable');
    case 'no_resources':
      return t('shared.reasonNoResources');
    default:
      return t('shared.unavailableDefault');
  }
}

async function copyPsysonicShare(request: OutboundShareRequest): Promise<boolean> {
  const serverId = singleOwnerServerId(request);
  if (!serverId) return false;
  if (request.kind !== 'queue') {
    return copyEntityShareLink(request.kind, request.resourceIds[0] ?? '', { serverId });
  }
  const server = useAuthStore.getState().servers.find(candidate => candidate.id === serverId);
  const srv = server ? serverShareBaseUrl(server) : '';
  if (!srv) return false;
  return copyTextToClipboard(encodeSharePayload({
    srv,
    k: 'queue',
    ids: [...request.resourceIds],
  }));
}

async function copyNavidromeShare(
  request: OutboundShareRequest,
): Promise<{ copied: boolean; created: boolean }> {
  const originalUrl = request.originalUrl?.trim();
  if (originalUrl) return { copied: await copyTextToClipboard(originalUrl), created: false };
  const serverId = singleOwnerServerId(request);
  if (!serverId || request.kind === 'composer') return { copied: false, created: false };
  const share = await useShareStore.getState().createShare(serverId, request.resourceIds, request.kind);
  return { copied: await copyTextToClipboard(share.url), created: true };
}

export function useOutboundShareModel(
  request: OutboundShareRequest,
  t: TFunction,
): OutboundShareModel {
  const identityByServer = useAuthStore(s => s.subsonicServerIdentityByServer);
  const shareStateByServer = useShareStore(s => s.byServer);
  const navidromeSharingEnabled = useShareSettingsStore(s => s.navidromeSharingEnabled);
  const serverId = singleOwnerServerId(request);
  const normalizedServerIds = request.serverIds.map(
    ownerId => findServerByIdOrIndexKey(ownerId)?.id ?? ownerId,
  );
  const navidromeAvailability = request.originalUrl?.trim()
    ? { available: true as const }
    : resolveNavidromeShareAvailability({
      identity: serverId ? identityByServer[serverId] : undefined,
      status: serverId ? shareStateByServer[serverId]?.availability ?? 'unknown' : 'unknown',
      kind: request.kind,
      resourceIds: request.resourceIds,
      serverIds: normalizedServerIds,
    });
  const psysonicAvailability = resolvePsysonicAvailability(request);
  const methods: OutboundShareModel['methods'] = request.originalOnly ? [] : [
    {
      id: 'psysonic',
      label: t('shared.methodPsysonic'),
      available: psysonicAvailability.available,
      reason: psysonicAvailability.available ? undefined : psysonicAvailability.reason,
    },
  ];
  if (navidromeSharingEnabled) {
    methods.push({
      id: 'navidrome',
      label: t('shared.methodNavidrome'),
      available: navidromeAvailability.available,
      reason: navidromeAvailability.available ? undefined : navidromeAvailability.reason,
    });
  }

  return {
    methods,
    share: async method => {
      const selected = methods.find(candidate => candidate.id === method);
      if (!selected?.available) return false;
      try {
        const result = method === 'psysonic'
          ? { copied: await copyPsysonicShare(request), created: false }
          : await copyNavidromeShare(request);
        if (result.created && !result.copied) {
          showToast(t('shared.createdCopyFailed'), 6000, 'error');
          return false;
        }
        showToast(
          result.copied ? t('contextMenu.shareCopied') : t('contextMenu.shareCopyFailed'),
          result.copied ? 3000 : 4000,
          result.copied ? 'info' : 'error',
        );
        return result.copied;
      } catch {
        showToast(t('contextMenu.shareCopyFailed'), 4000, 'error');
        return false;
      }
    },
  };
}
