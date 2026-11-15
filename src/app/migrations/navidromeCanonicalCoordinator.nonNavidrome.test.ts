import { beforeEach, describe, expect, it } from 'vitest';
import { invokeMock, onInvoke } from '@/test/mocks/tauri';
import {
  NAVIDROME_CANONICAL_BOOTSTRAP_LOCK_KEY as LOCK,
  NAVIDROME_CANONICAL_MIGRATION_CHECKPOINT_KEY as KEY,
  readNavidromeCanonicalMigrationCheckpoint,
  writeNavidromeCanonicalMigrationCheckpoint,
  type NavidromeCanonicalMigrationServerCheckpointV1 as Checkpoint,
} from './navidromeCanonicalCheckpoint';
import {
  observeNavidromeCanonicalSuccessfulPing as observe,
  runNavidromeCanonicalMigrationCoordinator as coordinate,
} from './navidromeCanonicalCoordinator';

const profile = {
  id: 'profile', name: 'Music', url: 'https://music.test', username: 'user', password: 'password',
};
const identities = [
  { type: 'MusicTagWeb', serverVersion: '2.8.0' },
  // Synthetic version; the issue's Jellyfin commenter did not supply one.
  { type: 'Jellyfin', serverVersion: '10.10.7' },
  { type: 'Unrelated server', serverVersion: '4.5.6' },
];
const identity = identities[0];
const downgrade = `Navidrome canonical ID namespace for music.test cannot be downgraded after ${identity.serverVersion}`;
const bootstrap = () => coordinate({ windowKind: 'main' });
const saved = () => readNavidromeCanonicalMigrationCheckpoint()?.servers['music.test'];

function seed(patch: Partial<Checkpoint> = {}): Checkpoint {
  const entry: Checkpoint = {
    sourceVersion: identity.serverVersion, checkedVersion: identity.serverVersion,
    canonicalVersion: 1, phase: 'blocked', step: null, cursorRowid: 0, upperRowid: 0,
    cursorKey: null, upperKey: null, startedAt: 1, updatedAt: 2,
    localCompletedAt: null, syncCompletedAt: null, lastError: downgrade, ...patch,
  };
  writeNavidromeCanonicalMigrationCheckpoint({ version: 1, servers: { 'music.test': entry } });
  return entry;
}

type Participant = { serverId: string; phase: Checkpoint['phase']; error: string | null };
function backend(participants?: Participant[]) {
  let active = participants !== undefined;
  let generation = 21;
  const servers = participants ?? [];
  const snapshot = () => active
    ? { state: 'active', generation, servers: servers.map(server => ({ ...server })) }
    : { state: 'inactive', lastGeneration: generation };
  onInvoke('library_migration_inspect', snapshot);
  const owner = (value: unknown) => {
    const args = value as Record<string, unknown>;
    if (!active || args.generation !== generation) throw new Error('wrong generation');
    const server = servers.find(candidate => candidate.serverId === args.serverId);
    if (!server) throw new Error('missing owner');
    return server;
  };
  onInvoke('library_migration_retry', args => {
    const server = owner(args);
    if (server.phase !== 'blocked') throw new Error('not blocked');
    server.phase = 'pending'; server.error = null;
  });
  onInvoke('library_migration_finish_server', args => {
    const server = owner(args);
    if (server.phase === 'blocked') throw new Error('must retry before finish');
    const phase = (args as { phase: Checkpoint['phase'] }).phase;
    if (!['ready', 'legacy', 'not-applicable'].includes(phase)) throw new Error('not terminal');
    server.phase = phase; server.error = null;
  });
  onInvoke('library_migration_release', args => {
    if (!active || (args as { generation: number }).generation !== generation) throw new Error('wrong generation');
    if (servers.some(server => !['ready', 'legacy', 'not-applicable'].includes(server.phase))) {
      throw new Error('nonterminal participant');
    }
    active = false;
  });
  return { snapshot, servers, changeGeneration: () => { generation += 1; } };
}
const blocked = (): Participant => ({ serverId: 'music.test', phase: 'blocked', error: downgrade });
const migrationWrites = () => invokeMock.mock.calls.filter(([command]) => (
  command.startsWith('library_migration_') && command !== 'library_migration_inspect'
));

describe('non-Navidrome canonical checkpoint lifecycle', () => {
  beforeEach(() => {
    localStorage.setItem('psysonic-auth', JSON.stringify({
      state: { servers: [profile], activeServerId: profile.id }, version: 1,
    }));
    onInvoke('probe_server_connection', () => ({ ok: true, ...identity }));
    // Boundary filesystem operation used by the real backup-commit helper.
    onInvoke('backup_commit_imported_databases', () => null);
  });

  it.each(identities)('keeps repeated startup/runtime observations cheap for $type', async ping => {
    backend();
    onInvoke('probe_server_connection', () => ({ ok: true, ...ping }));
    for (let index = 0; index < 3; index += 1) {
      await expect(bootstrap()).resolves.toEqual({ blocked: false, migratedServers: 0 });
      await expect(observe({ profile, ping })).resolves.toBe(false);
    }
    expect(saved()).toMatchObject({ phase: 'not-applicable', sourceVersion: ping.serverVersion, checkedVersion: null });
    expect(migrationWrites()).toEqual([]);
    expect(invokeMock.mock.calls.filter(([command]) => command === 'library_migration_inspect')).toHaveLength(3);
    expect(localStorage.getItem(LOCK)).toBeNull();
  });

  it.each(['not-applicable', 'legacy', 'retryable'] as const)('does not promote a %s raw version into namespace evidence', async phase => {
    seed({ phase, lastError: null });
    backend();
    await expect(observe({ profile, ping: identity })).resolves.toBe(false);
    await expect(bootstrap()).resolves.toEqual({ blocked: false, migratedServers: 0 });
    expect(saved()?.checkedVersion).toBeNull();
    expect(migrationWrites()).toEqual([]);
  });

  it.each(identities)('recovers the exact old $type poison on cold startup without any native write', async ping => {
    seed({ sourceVersion: ping.serverVersion, checkedVersion: ping.serverVersion,
      lastError: `Navidrome canonical ID namespace for music.test cannot be downgraded after ${ping.serverVersion}` });
    backend();
    onInvoke('probe_server_connection', () => ({ ok: true, ...ping }));
    await expect(bootstrap()).resolves.toEqual({ blocked: false, migratedServers: 0 });
    expect(saved()).toMatchObject({ phase: 'not-applicable', checkedVersion: null, lastError: null });
    await expect(bootstrap()).resolves.toEqual({ blocked: false, migratedServers: 0 });
    expect(migrationWrites()).toEqual([]);
  });

  it.each(identities)('retries then finishes the matching live $type blocked owner before releasing', async ping => {
    const entry = seed({ sourceVersion: ping.serverVersion, checkedVersion: ping.serverVersion,
      lastError: `Navidrome canonical ID namespace for music.test cannot be downgraded after ${ping.serverVersion}` });
    const native = backend([{ ...blocked(), error: entry.lastError }]);
    onInvoke('probe_server_connection', () => ({ ok: true, ...ping }));
    await expect(bootstrap()).resolves.toEqual({ blocked: false, migratedServers: 0 });
    expect(migrationWrites()).toEqual([
      ['library_migration_retry', { generation: 21, serverId: 'music.test' }],
      ['library_migration_finish_server', { generation: 21, serverId: 'music.test', phase: 'not-applicable' }],
      ['library_migration_release', { generation: 21 }],
    ]);
    expect(native.snapshot().state).toBe('inactive');
    expect(localStorage.getItem(LOCK)).toBeNull();
    await expect(bootstrap()).resolves.toEqual({ blocked: false, migratedServers: 0 });
  });

  it('runtime arms a reload, leaving repair and unlock to bootstrap', async () => {
    seed(); backend([blocked()]);
    await expect(observe({ profile, ping: identity })).resolves.toBe(true);
    expect(saved()?.phase).toBe('blocked');
    expect(localStorage.getItem(LOCK)).not.toBeNull();
    expect(migrationWrites()).toEqual([]);
    await expect(bootstrap()).resolves.toEqual({ blocked: false, migratedServers: 0 });
  });

  it('does not clear another operation lock during a runtime recovery request', async () => {
    seed(); backend(); localStorage.setItem(LOCK, 'runtime:other:owner');
    await expect(observe({ profile, ping: identity })).resolves.toBe(true);
    expect(localStorage.getItem(LOCK)).toBe('runtime:other:owner');
    expect(migrationWrites()).toEqual([]);
  });

  const ambiguous: Array<[string, Partial<Checkpoint>]> = [
    ['different source', { sourceVersion: '0.63.2' }],
    ['missing checked version', { checkedVersion: null }],
    ['custom checked version', { checkedVersion: 'custom-build' }],
    ['step', { step: 'artist' }],
    ['row cursor', { cursorRowid: 1 }],
    ['row upper', { upperRowid: 1 }],
    ['key cursor', { cursorKey: 'cover' }],
    ['key upper', { upperKey: 'cover' }],
    ['local completion', { localCompletedAt: 0 }],
    ['sync completion', { syncCompletedAt: 0 }],
    ['error mismatch', { lastError: 'Native migration failed' }],
    ['missing error', { lastError: null }],
    ['pending canonical', { phase: 'pending' }],
    ['native canonical', { phase: 'native' }],
    ['analysis canonical', { phase: 'analysis' }],
    ['cover canonical', { phase: 'cover' }],
    ['frontend canonical', { phase: 'frontend' }],
    ['cleanup canonical', { phase: 'cleanup' }],
    ['sync canonical', { phase: 'sync' }],
  ];
  it.each(ambiguous)('preserves %s evidence rather than resetting it', async (_name, patch) => {
    const entry = seed(patch); backend();
    await expect(bootstrap()).rejects.toThrow();
    expect(saved()).toEqual(entry);
    expect(migrationWrites()).toEqual([]);
    expect(localStorage.getItem(LOCK)).toBe('1');
  });

  it.each([undefined, null, '', '  ', 'unknown', 'navidrome'])('does not recover with missing/unknown Navidrome identity %s', async type => {
    const entry = seed(); backend();
    onInvoke('probe_server_connection', () => ({ ok: true, type,
      serverVersion: type === 'navidrome' ? 'custom-build' : identity.serverVersion }));
    await expect(bootstrap()).rejects.toThrow();
    expect(saved()).toEqual(entry);
    expect(migrationWrites()).toEqual([]);
    expect(localStorage.getItem(LOCK)).toBe('1');
  });

  it('does not recover offline', async () => {
    const entry = seed(); backend();
    onInvoke('probe_server_connection', () => ({ ok: false }));
    await expect(bootstrap()).rejects.toThrow('unreachable');
    expect(saved()).toEqual(entry);
    expect(migrationWrites()).toEqual([]);
  });

  it.each([
    { serverId: 'music.test', phase: 'blocked', error: 'other failure' },
    { serverId: 'music.test', phase: 'blocked', error: null },
    { serverId: 'music.test', phase: 'native', error: null },
    { serverId: 'other.test', phase: 'blocked', error: downgrade },
  ] satisfies Participant[])('preserves incompatible native evidence $serverId/$phase/$error', async owner => {
    const entry = seed(); backend([owner]);
    await expect(bootstrap()).rejects.toThrow();
    expect(saved()).toEqual(entry);
    expect(migrationWrites()).toEqual([]);
    expect(localStorage.getItem(LOCK)).toBe('1');
  });

  it('does not guess provenance from a backend-only error', async () => {
    backend([blocked()]);
    await expect(bootstrap()).rejects.toThrow();
    expect(saved()).toBeUndefined();
    expect(migrationWrites()).toEqual([]);
    expect(localStorage.getItem(LOCK)).toBe('1');
  });

  it('refuses a current non-Navidrome version different from the poisoned version', async () => {
    const entry = seed(); backend();
    onInvoke('probe_server_connection', () => ({ ok: true, ...identity, serverVersion: '2.8.1' }));
    await expect(bootstrap()).rejects.toThrow();
    expect(saved()).toEqual(entry);
    expect(migrationWrites()).toEqual([]);
  });

  it('leaves stale runtime observations and other operation locks untouched', async () => {
    const entry = seed(); backend(); localStorage.setItem(LOCK, 'runtime:other:owner');
    await expect(observe({ profile, ping: identity, isCurrent: () => false })).rejects.toThrow('became stale');
    expect(localStorage.getItem(LOCK)).toBe('runtime:other:owner');
    expect(saved()).toEqual(entry);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('revalidates the profile after runtime gate acquisition before requesting reload', async () => {
    const entry = seed(); backend();
    await expect(observe({ profile, ping: identity, beforeAdmission: () => {
      localStorage.setItem('psysonic-auth', JSON.stringify({ state: {
        servers: [{ ...profile, url: 'https://replacement.test' }], activeServerId: profile.id,
      }, version: 1 }));
    } })).rejects.toThrow('became stale');
    expect(saved()).toEqual(entry);
    expect(localStorage.getItem(LOCK)).not.toBeNull();
    expect(migrationWrites()).toEqual([]);
  });

  it('serializes duplicate runtime recovery requests without repairing mounted stores', async () => {
    const entry = seed(); backend([blocked()]);
    await expect(Promise.all([
      observe({ profile, ping: identity }), observe({ profile, ping: identity }),
    ])).resolves.toEqual([true, true]);
    expect(saved()).toEqual(entry);
    expect(localStorage.getItem(LOCK)).not.toBeNull();
    expect(migrationWrites()).toEqual([]);
  });

  it('propagates a recovery inspect failure without resetting the checkpoint', async () => {
    const entry = seed(); const native = backend([blocked()]); let inspections = 0;
    onInvoke('library_migration_inspect', () => {
      if (++inspections === 2) throw new Error('inspect failed');
      return native.snapshot();
    });
    await expect(bootstrap()).rejects.toThrow('inspect failed');
    expect(saved()).toEqual(entry);
    expect(migrationWrites()).toEqual([]);
    expect(localStorage.getItem(LOCK)).toBe('1');
  });

  it('does not release after another participant becomes nonterminal during recovery', async () => {
    seed(); const native = backend([blocked(), { serverId: 'other.test', phase: 'ready', error: null }]);
    let inspections = 0;
    onInvoke('library_migration_inspect', () => {
      if (++inspections === 3) native.servers[1].phase = 'native';
      return native.snapshot();
    });
    await expect(bootstrap()).rejects.toThrow();
    expect(invokeMock).not.toHaveBeenCalledWith('library_migration_release', expect.anything());
    expect(localStorage.getItem(LOCK)).toBe('1');
  });

  it('uses a fresh inspect and refuses a replaced generation', async () => {
    const entry = seed(); const native = backend([blocked()]);
    onInvoke('probe_server_connection', () => {
      native.changeGeneration(); return { ok: true, ...identity };
    });
    await expect(bootstrap()).rejects.toThrow();
    expect(saved()).toEqual(entry);
    expect(migrationWrites()).toEqual([]);
  });

  it('does not release a multi-server barrier with another blocked participant', async () => {
    seed(); const other = { serverId: 'other.test', phase: 'blocked', error: 'real migration failure' } as const;
    const native = backend([blocked(), { ...other }]);
    await expect(bootstrap()).rejects.toThrow();
    expect(native.servers[0].phase).toBe('not-applicable');
    expect(native.servers[1]).toEqual(other);
    expect(invokeMock).not.toHaveBeenCalledWith('library_migration_release', expect.anything());
    expect(localStorage.getItem(LOCK)).toBe('1');
  });

  it('can release a multi-server generation only when the other participant is terminal', async () => {
    seed(); backend([blocked(), { serverId: 'other.test', phase: 'ready', error: null }]);
    await expect(bootstrap()).resolves.toEqual({ blocked: false, migratedServers: 0 });
    expect(invokeMock).toHaveBeenCalledWith('library_migration_release', { generation: 21 });
  });

  it.each(['library_migration_retry', 'library_migration_finish_server', 'library_migration_release'])('keeps bootstrap gated on %s failure', async command => {
    seed(); backend([blocked()]);
    onInvoke(command, () => { throw new Error('IPC failed'); });
    await expect(bootstrap()).rejects.toThrow('IPC failed');
    expect(localStorage.getItem(LOCK)).toBe('1');
    if (command !== 'library_migration_release') expect(saved()?.phase).toBe('blocked');
  });

  it('keeps real canonical history protected after an endpoint changes identity', async () => {
    const entry = seed({ phase: 'pending', localCompletedAt: 10, syncCompletedAt: 11 });
    backend();
    await expect(bootstrap()).rejects.toThrow('cannot discard');
    expect(saved()).toEqual(entry);
    await expect(observe({ profile, ping: identity })).rejects.toThrow('already active');
    expect(localStorage.getItem(LOCK)).toBe('1');
  });

  it('finishes a non-Navidrome backup import without migration and stays non-applicable', async () => {
    seed({ phase: 'pending', checkedVersion: null, step: 'backup-import', lastError: null });
    backend([{ serverId: 'music.test', phase: 'pending', error: null }]);
    await expect(bootstrap()).resolves.toEqual({ blocked: false, migratedServers: 0 });
    expect(migrationWrites().map(([command]) => command)).toEqual([
      'library_migration_finish_server', 'library_migration_release',
    ]);
    await expect(bootstrap()).resolves.toEqual({ blocked: false, migratedServers: 0 });
    expect(saved()).toMatchObject({ phase: 'not-applicable', checkedVersion: null });
  });

  it('rejects malformed checkpoint provenance without changing persisted data', async () => {
    seed(); backend();
    const raw = JSON.parse(localStorage.getItem(KEY)!);
    raw.servers['music.test'].cursorRowid = -1;
    const text = JSON.stringify(raw); localStorage.setItem(KEY, text);
    await expect(bootstrap()).rejects.toThrow('Invalid canonical migration checkpoint');
    expect(localStorage.getItem(KEY)).toBe(text);
    expect(migrationWrites()).toEqual([]);
  });
});
