import { buildCapabilityContext } from '@/lib/serverCapabilities/context';
import type { Semver } from '@/lib/serverCapabilities/types';
import type { SubsonicServerIdentity } from '@/lib/server/subsonicServerIdentity';

export const NAVIDROME_SHARE_MIN_VERSION: Semver = [0, 64, 0];

export type ShareAvailabilityStatus =
  | 'unknown'
  | 'available'
  | 'unsupported'
  | 'sharing_disabled'
  | 'server_unavailable';

export type ShareAvailabilityReason =
  | 'not_navidrome'
  | 'identity_unknown'
  | 'version_too_old'
  | 'sharing_disabled'
  | 'server_unavailable'
  | 'multiple_servers'
  | 'server_owner_unknown'
  | 'composer_unsupported'
  | 'no_resources';

export type ShareAvailability =
  | { available: true }
  | { available: false; reason: ShareAvailabilityReason };

export interface ResolveShareAvailabilityInput {
  identity: SubsonicServerIdentity | undefined;
  status: ShareAvailabilityStatus;
  kind?: string;
  resourceIds: readonly string[];
  serverIds: readonly string[];
}

export function resolveNavidromeShareServerEligibility(
  identity: SubsonicServerIdentity | undefined,
): ShareAvailability {
  const context = buildCapabilityContext(identity);
  if (!identity?.type?.trim()) return { available: false, reason: 'identity_unknown' };
  if (!context.isNavidrome) return { available: false, reason: 'not_navidrome' };
  if (!context.version) return { available: false, reason: 'identity_unknown' };
  if (!context.semverGte(NAVIDROME_SHARE_MIN_VERSION)) {
    return { available: false, reason: 'version_too_old' };
  }
  return { available: true };
}

export function resolveNavidromeShareAvailability(
  input: ResolveShareAvailabilityInput,
): ShareAvailability {
  if (input.kind === 'composer') return { available: false, reason: 'composer_unsupported' };
  if (!input.resourceIds.some(id => id.length > 0)) return { available: false, reason: 'no_resources' };

  if (input.serverIds.length === 0 || input.serverIds.some(serverId => !serverId)) {
    return { available: false, reason: 'server_owner_unknown' };
  }
  const owners = new Set(input.serverIds);
  if (owners.size === 0) return { available: false, reason: 'server_owner_unknown' };
  if (owners.size > 1) return { available: false, reason: 'multiple_servers' };

  const eligibility = resolveNavidromeShareServerEligibility(input.identity);
  if (!eligibility.available) return eligibility;
  if (input.status === 'sharing_disabled') return { available: false, reason: 'sharing_disabled' };
  if (input.status !== 'available') return { available: false, reason: 'server_unavailable' };
  return { available: true };
}
