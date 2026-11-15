import type { NavidromeCanonicalMigrationServerCheckpointV1 as Checkpoint } from './navidromeCanonicalCheckpoint';
import { classifyNavidromeCanonicalVersion, type SuccessfulPingIdentity } from './navidromeCanonicalVersion';

function versionLooksCanonical(version: string | null): boolean {
  return classifyNavidromeCanonicalVersion({ type: 'navidrome', serverVersion: version }) === 'canonical';
}

function hasNoMigrationWork(checkpoint: Checkpoint): boolean {
  return checkpoint.step === null
    && checkpoint.cursorRowid === 0 && checkpoint.upperRowid === 0
    && checkpoint.cursorKey === null && checkpoint.upperKey === null
    && checkpoint.localCompletedAt === null && checkpoint.syncCompletedAt === null;
}

/** v1's canonicalVersion is a format marker, not evidence of the server's identity. */
export function checkpointHasCanonicalNamespace(checkpoint: Checkpoint | undefined): boolean {
  if (!checkpoint?.checkedVersion || !versionLooksCanonical(checkpoint.checkedVersion)) return false;
  // Old terminal probes stored unrelated versions here. Real canonical checkpoints
  // originate in ready; their evidence survives pending/blocked transitions.
  return !['not-applicable', 'legacy', 'retryable'].includes(checkpoint.phase)
    || !hasNoMigrationWork(checkpoint);
}

export function canonicalNamespaceDowngradeError(serverId: string, checkedVersion: string | null): string {
  return `Navidrome canonical ID namespace for ${serverId} cannot be downgraded after ${checkedVersion}`;
}

/** Recognise only the pre-work false downgrade produced by the old coordinator.
 * Legitimate checked canonical versions are written with completion timestamps;
 * later admissions/downgrades preserve those timestamps. An error alone is not
 * proof: require the unchanged version and absence of every work marker as well.
 */
export function checkpointIsFalseNonNavidromeBlock(
  serverId: string,
  checkpoint: Checkpoint | undefined,
  ping: SuccessfulPingIdentity,
): checkpoint is Checkpoint & { lastError: string } {
  const type = ping.type?.trim().toLowerCase();
  return Boolean(type && type !== 'unknown' && type !== 'navidrome'
    && checkpoint?.phase === 'blocked'
    && hasNoMigrationWork(checkpoint)
    && checkpoint.checkedVersion !== null
    && versionLooksCanonical(checkpoint.checkedVersion)
    && checkpoint.sourceVersion === checkpoint.checkedVersion
    && ping.serverVersion === checkpoint.sourceVersion
    && checkpoint.lastError === canonicalNamespaceDowngradeError(serverId, checkpoint.checkedVersion));
}
