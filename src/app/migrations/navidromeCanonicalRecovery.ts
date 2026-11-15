import { invoke } from '@tauri-apps/api/core';
import type { NavidromeCanonicalMigrationPhase } from './navidromeCanonicalCheckpoint';

export type MigrationSnapshot =
  | { state: 'inactive'; lastGeneration: number }
  | {
      state: 'active';
      generation: number;
      servers: Array<{ serverId: string; phase: NavidromeCanonicalMigrationPhase; error?: string | null }>;
    };

/** Only called after the shared namespace predicate proves a pre-work false block.
 * No begin/release here: startup owns the lock and the whole generation's completion.
 * Without the frontend checkpoint v1's native phase/error alone cannot prove that
 * no durable migration work happened, so backend-only recovery is unsupported.
 */
export async function recoverFalseNonNavidromeBackendBlock(args: {
  serverId: string;
  error: string;
  backendAtStart: MigrationSnapshot;
}): Promise<boolean> {
  const { serverId, error, backendAtStart } = args;
  const fresh = await invoke<MigrationSnapshot>('library_migration_inspect');
  if (backendAtStart.state === 'inactive' && fresh.state === 'inactive') return false;
  if (backendAtStart.state !== 'active' || fresh.state !== 'active'
    || fresh.generation !== backendAtStart.generation) {
    throw new Error(`Canonical checkpoint recovery for ${serverId} lost its migration generation`);
  }
  const matches = (snapshot: typeof fresh) => {
    const owners = snapshot.servers.filter(server => server.serverId === serverId);
    return owners.length === 1 && owners[0].phase === 'blocked' && owners[0].error === error;
  };
  if (!matches(backendAtStart) || !matches(fresh)) {
    throw new Error(`Canonical checkpoint recovery for ${serverId} has incompatible backend evidence`);
  }
  const { generation } = fresh;
  await invoke('library_migration_retry', { generation, serverId });
  await invoke('library_migration_finish_server', { generation, serverId, phase: 'not-applicable' });
  return true;
}
