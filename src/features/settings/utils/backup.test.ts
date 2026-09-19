import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  writeFile: vi.fn(),
  invoke: vi.fn(),
  backupImportLibraryDb: vi.fn(),
  backupRollbackImportedDatabases: vi.fn(),
  backupCommitImportedDatabases: vi.fn(),
  backupInspectFullImportRecovery: vi.fn(),
  backupRecoverFullImportDatabases: vi.fn(),
  backupFinalizeFullImportRecovery: vi.fn(),
  libraryMigrationInspect: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(),
  open: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({
  writeFile: mocks.writeFile,
  readTextFile: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/generated/bindings', () => ({
  commands: {
    backupExportLibraryDb: vi.fn(),
    backupImportLibraryDb: mocks.backupImportLibraryDb,
    backupRollbackImportedDatabases: mocks.backupRollbackImportedDatabases,
    backupCommitImportedDatabases: mocks.backupCommitImportedDatabases,
    backupInspectFullImportRecovery: mocks.backupInspectFullImportRecovery,
    backupRecoverFullImportDatabases: mocks.backupRecoverFullImportDatabases,
    backupFinalizeFullImportRecovery: mocks.backupFinalizeFullImportRecovery,
    libraryMigrationInspect: mocks.libraryMigrationInspect,
  },
}));

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  activateFullBackupOrRollback,
  BACKUP_KEYS,
  commitImportedBackupRecovery,
  FULL_BACKUP_IMPORT_JOURNAL_KEY,
  exportBackupToPath,
  importDatabaseBackupFromPath,
  installImportedBackupCoordinator,
  reconcileFullBackupImportRecovery,
  restoreBackupStores,
} from './backup';

beforeEach(() => {
  mocks.writeFile.mockReset();
  mocks.invoke.mockReset().mockImplementation(async (command: string) => (
    command === 'library_migration_begin'
      ? {
          generation: 7,
          created: true,
          servers: [{ serverId: 'music.test', previousPhase: null }],
        }
      : undefined
  ));
  mocks.backupImportLibraryDb.mockReset().mockResolvedValue({ status: 'ok', data: null });
  mocks.backupRollbackImportedDatabases.mockReset().mockResolvedValue({ status: 'ok', data: null });
  mocks.backupCommitImportedDatabases.mockReset().mockResolvedValue({ status: 'ok', data: null });
  mocks.backupInspectFullImportRecovery.mockReset().mockResolvedValue({ status: 'ok', data: null });
  mocks.backupRecoverFullImportDatabases.mockReset().mockResolvedValue({ status: 'ok', data: null });
  mocks.backupFinalizeFullImportRecovery.mockReset().mockResolvedValue({ status: 'ok', data: null });
  mocks.libraryMigrationInspect.mockReset().mockResolvedValue({
    status: 'ok',
    data: { state: 'inactive', lastGeneration: 0 },
  });
  localStorage.clear();
});

describe('settings backup stores', () => {
  it('round-trips visualizer preferences and Now Playing card layout', async () => {
    const visualizer = { state: { enabled: true, mode: 'radial', fps: 45 }, version: 0 };
    const layout = {
      state: {
        cards: [{ id: 'visualizer', column: 'right', visible: false }],
      },
      version: 0,
    };
    localStorage.setItem('psysonic_visualizer', JSON.stringify(visualizer));
    localStorage.setItem('psysonic_np_layout', JSON.stringify(layout));

    await exportBackupToPath('config', '/tmp/settings.psybkp');
    const bytes = mocks.writeFile.mock.calls[0]?.[1] as Uint8Array;
    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as {
      stores: Record<string, unknown>;
    };
    expect(manifest.stores.psysonic_visualizer).toEqual(visualizer);
    expect(manifest.stores.psysonic_np_layout).toEqual(layout);

    localStorage.clear();
    restoreBackupStores(manifest.stores);
    expect(JSON.parse(localStorage.getItem('psysonic_visualizer') ?? 'null')).toEqual(visualizer);
    expect(JSON.parse(localStorage.getItem('psysonic_np_layout') ?? 'null')).toEqual(layout);
  });

  it('round-trips the language without quoting it into the stored value', async () => {
    // `psysonic_language` is the one backup key holding a bare string rather
    // than a serialized store, so `collectStores` carries it raw. Restoring it
    // through `JSON.stringify` used to write `"en"` — quotes included — which
    // is not a valid BCP-47 tag and made every Intl call from it throw.
    localStorage.setItem('psysonic_language', 'de');

    await exportBackupToPath('config', '/tmp/settings.psybkp');
    const bytes = mocks.writeFile.mock.calls[0]?.[1] as Uint8Array;
    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as {
      stores: Record<string, unknown>;
    };
    expect(manifest.stores.psysonic_language).toBe('de');

    localStorage.clear();
    restoreBackupStores(manifest.stores);
    expect(localStorage.getItem('psysonic_language')).toBe('de');
  });

  it('heals an already-quoted language when it is exported and restored again', async () => {
    // An install damaged by the old behaviour: the quotes are part of the value.
    localStorage.setItem('psysonic_language', '"en"');

    await exportBackupToPath('config', '/tmp/settings.psybkp');
    const bytes = mocks.writeFile.mock.calls[0]?.[1] as Uint8Array;
    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as {
      stores: Record<string, unknown>;
    };
    // Export parses the quoted value cleanly, so the manifest already holds `en`.
    expect(manifest.stores.psysonic_language).toBe('en');

    localStorage.clear();
    restoreBackupStores(manifest.stores);
    expect(localStorage.getItem('psysonic_language')).toBe('en');
  });

  it('restores only allowlisted stores and removes allowlisted values absent from the backup', () => {
    localStorage.setItem('psysonic-player', JSON.stringify({ state: { currentTrack: 'old' } }));
    restoreBackupStores({
      psysonic_theme: 'dark',
      unexpected_store: { unsafe: true },
    });

    expect(localStorage.getItem('psysonic-player')).toBeNull();
    expect(JSON.parse(localStorage.getItem('psysonic_theme') ?? 'null')).toBe('dark');
    expect(localStorage.getItem('unexpected_store')).toBeNull();
  });

  it('activates normalized full-backup stores under a migration generation', async () => {
    const cleanup = installImportedBackupCoordinator({
      arm: vi.fn(),
      disarm: vi.fn(),
      captureRecoveryState: () => ({ checkpoint: 'previous-checkpoint' }),
      restoreRecoveryState: vi.fn(),
      normalizeStores: stores => ({ ...stores, psysonic_theme: 'canonical' }),
      prepareDatabaseImport: () => ({
        serverIds: ['music.test'],
        canonicalServerIds: ['music.test'],
        rollbackCheckpoint: vi.fn(),
      }),
    });

    await activateFullBackupOrRollback('/tmp/full.psyfull', { psysonic_theme: 'legacy' });

    expect(mocks.invoke).toHaveBeenCalledWith('library_migration_begin', {
      serverIds: ['music.test'],
    });
    expect(mocks.backupImportLibraryDb).toHaveBeenCalledWith(
      '/tmp/full.psyfull',
      ['music.test'],
      7,
      true,
    );
    expect(JSON.parse(localStorage.getItem('psysonic_theme') ?? 'null')).toBe('canonical');
    expect(JSON.parse(localStorage.getItem(FULL_BACKUP_IMPORT_JOURNAL_KEY) ?? '{}')).toMatchObject({
      version: 1,
      phase: 'activated',
      migrationGeneration: 7,
      previousCoordinatorState: { checkpoint: 'previous-checkpoint' },
    });
    cleanup();
  });

  it('retains database rollback copies until migration startup reaches a terminal state', async () => {
    const cleanup = installImportedBackupCoordinator({
      arm: vi.fn(),
      disarm: vi.fn(),
      captureRecoveryState: () => ({}),
      restoreRecoveryState: vi.fn(),
      normalizeStores: stores => stores,
      prepareDatabaseImport: () => ({
        serverIds: ['music.test'],
        canonicalServerIds: ['music.test'],
        rollbackCheckpoint: vi.fn(),
      }),
    });

    await importDatabaseBackupFromPath('/tmp/library.psylib');

    expect(mocks.backupImportLibraryDb).toHaveBeenCalledWith(
      '/tmp/library.psylib',
      ['music.test'],
      7,
      false,
    );
    expect(mocks.backupCommitImportedDatabases).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith('library_migration_release', expect.anything());
    cleanup();
  });

  it('rolls databases, stores, checkpoint, and generation back when store activation fails', async () => {
    localStorage.setItem('psysonic_theme', JSON.stringify('previous'));
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const rollbackCheckpoint = vi.fn();
    const disarm = vi.fn();
    const restoreRecoveryState = vi.fn();
    const cleanup = installImportedBackupCoordinator({
      arm: vi.fn(),
      disarm,
      captureRecoveryState: () => ({ checkpoint: 'previous' }),
      restoreRecoveryState,
      normalizeStores: () => ({ psysonic_theme: cyclic }),
      prepareDatabaseImport: () => ({
        serverIds: ['music.test'],
        canonicalServerIds: ['music.test'],
        rollbackCheckpoint,
      }),
    });
    mocks.backupInspectFullImportRecovery.mockResolvedValue({
      status: 'ok',
      data: { phase: 'prepared', migrationGeneration: 7 },
    });
    mocks.libraryMigrationInspect.mockResolvedValue({
      status: 'ok',
      data: { state: 'active', generation: 7, servers: [{ serverId: 'music.test', phase: 'pending' }] },
    });

    await expect(activateFullBackupOrRollback('/tmp/full.psyfull', {}))
      .rejects.toThrow('circular');

    expect(mocks.backupRecoverFullImportDatabases).toHaveBeenCalledOnce();
    expect(mocks.backupFinalizeFullImportRecovery).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledWith('library_migration_release', { generation: 7 });
    expect(JSON.parse(localStorage.getItem('psysonic_theme') ?? 'null')).toBe('previous');
    expect(restoreRecoveryState).toHaveBeenCalledWith({ checkpoint: 'previous' });
    expect(rollbackCheckpoint).not.toHaveBeenCalled();
    expect(disarm).toHaveBeenCalledOnce();
    expect(localStorage.getItem(FULL_BACKUP_IMPORT_JOURNAL_KEY)).toBeNull();
    cleanup();
  });

  it('startup restores databases, exact previous stores, and coordinator state for a prepared journal', async () => {
    localStorage.setItem('psysonic_theme', JSON.stringify('previous'));
    const restoreRecoveryState = vi.fn();
    const disarm = vi.fn();
    const cleanup = installImportedBackupCoordinator({
      arm: vi.fn(),
      disarm,
      captureRecoveryState: () => ({ checkpoint: 'previous-checkpoint' }),
      restoreRecoveryState,
      normalizeStores: stores => stores,
      prepareDatabaseImport: () => ({
        serverIds: ['music.test'],
        canonicalServerIds: ['music.test'],
        rollbackCheckpoint: vi.fn(),
      }),
    });
    await activateFullBackupOrRollback('/tmp/full.psyfull', { psysonic_theme: 'imported' });
    const journal = JSON.parse(localStorage.getItem(FULL_BACKUP_IMPORT_JOURNAL_KEY) ?? '{}');
    journal.phase = 'prepared';
    localStorage.setItem(FULL_BACKUP_IMPORT_JOURNAL_KEY, JSON.stringify(journal));
    mocks.backupInspectFullImportRecovery.mockResolvedValue({
      status: 'ok',
      data: { phase: 'prepared', migrationGeneration: 7 },
    });
    mocks.libraryMigrationInspect.mockResolvedValue({
      status: 'ok',
      data: { state: 'active', generation: 7, servers: [{ serverId: 'music.test', phase: 'pending' }] },
    });

    await reconcileFullBackupImportRecovery();

    expect(JSON.parse(localStorage.getItem('psysonic_theme') ?? 'null')).toBe('previous');
    expect(restoreRecoveryState).toHaveBeenCalledWith({ checkpoint: 'previous-checkpoint' });
    expect(mocks.backupRecoverFullImportDatabases).toHaveBeenCalledOnce();
    expect(mocks.backupFinalizeFullImportRecovery).toHaveBeenCalledOnce();
    expect(disarm).toHaveBeenCalledOnce();
    expect(localStorage.getItem(FULL_BACKUP_IMPORT_JOURNAL_KEY)).toBeNull();
    cleanup();
  });

  it('startup preserves an activated import while its canonical migration is pending', async () => {
    const cleanup = installImportedBackupCoordinator({
      arm: vi.fn(),
      disarm: vi.fn(),
      captureRecoveryState: () => ({}),
      restoreRecoveryState: vi.fn(),
      normalizeStores: stores => stores,
      prepareDatabaseImport: () => ({
        serverIds: [], canonicalServerIds: [], rollbackCheckpoint: vi.fn(),
      }),
    });
    await activateFullBackupOrRollback('/tmp/full.psyfull', { psysonic_theme: 'imported' });
    expect(mocks.invoke).toHaveBeenCalledWith('library_migration_begin', { serverIds: [] });
    expect(JSON.parse(localStorage.getItem(FULL_BACKUP_IMPORT_JOURNAL_KEY) ?? '{}'))
      .toMatchObject({ migrationGeneration: 7 });
    mocks.backupInspectFullImportRecovery.mockResolvedValue({
      status: 'ok',
      data: { phase: 'prepared', migrationGeneration: 7 },
    });

    await reconcileFullBackupImportRecovery();

    expect(JSON.parse(localStorage.getItem('psysonic_theme') ?? 'null')).toBe('imported');
    expect(mocks.backupRecoverFullImportDatabases).not.toHaveBeenCalled();
    expect(localStorage.getItem(FULL_BACKUP_IMPORT_JOURNAL_KEY)).not.toBeNull();
    cleanup();
  });

  it('startup clears an activated journal when the committed Rust marker is already gone', async () => {
    const cleanup = installImportedBackupCoordinator({
      arm: vi.fn(),
      disarm: vi.fn(),
      captureRecoveryState: () => ({}),
      restoreRecoveryState: vi.fn(),
      normalizeStores: stores => stores,
      prepareDatabaseImport: () => ({
        serverIds: [], canonicalServerIds: [], rollbackCheckpoint: vi.fn(),
      }),
    });
    await activateFullBackupOrRollback('/tmp/full.psyfull', { psysonic_theme: 'imported' });

    await reconcileFullBackupImportRecovery();

    expect(JSON.parse(localStorage.getItem('psysonic_theme') ?? 'null')).toBe('imported');
    expect(localStorage.getItem(FULL_BACKUP_IMPORT_JOURNAL_KEY)).toBeNull();
    cleanup();
  });

  it('startup treats a persisted generation as already released after runtime restart', async () => {
    localStorage.setItem('psysonic_theme', JSON.stringify('previous'));
    const restoreRecoveryState = vi.fn();
    const cleanup = installImportedBackupCoordinator({
      arm: vi.fn(),
      disarm: vi.fn(),
      captureRecoveryState: () => ({ checkpoint: 'previous-checkpoint' }),
      restoreRecoveryState,
      normalizeStores: stores => stores,
      prepareDatabaseImport: () => ({
        serverIds: [], canonicalServerIds: [], rollbackCheckpoint: vi.fn(),
      }),
    });
    await activateFullBackupOrRollback('/tmp/full.psyfull', { psysonic_theme: 'imported' });
    const journal = JSON.parse(localStorage.getItem(FULL_BACKUP_IMPORT_JOURNAL_KEY) ?? '{}');
    journal.phase = 'prepared';
    localStorage.setItem(FULL_BACKUP_IMPORT_JOURNAL_KEY, JSON.stringify(journal));

    await reconcileFullBackupImportRecovery();

    expect(JSON.parse(localStorage.getItem('psysonic_theme') ?? 'null')).toBe('previous');
    expect(restoreRecoveryState).toHaveBeenCalledWith({ checkpoint: 'previous-checkpoint' });
    expect(mocks.backupRecoverFullImportDatabases).not.toHaveBeenCalled();
    expect(mocks.libraryMigrationInspect).toHaveBeenCalledOnce();
    expect(mocks.invoke).not.toHaveBeenCalledWith('library_migration_release', expect.anything());
    expect(localStorage.getItem(FULL_BACKUP_IMPORT_JOURNAL_KEY)).toBeNull();
    cleanup();
  });

  it('restart restores an empty-generation durable import while runtime is inactive', async () => {
    localStorage.setItem('psysonic_theme', JSON.stringify('previous'));
    const restoreRecoveryState = vi.fn();
    const cleanup = installImportedBackupCoordinator({
      arm: vi.fn(),
      disarm: vi.fn(),
      captureRecoveryState: () => ({ checkpoint: 'previous-checkpoint' }),
      restoreRecoveryState,
      normalizeStores: stores => stores,
      prepareDatabaseImport: () => ({
        serverIds: [], canonicalServerIds: [], rollbackCheckpoint: vi.fn(),
      }),
    });
    await activateFullBackupOrRollback('/tmp/full.psyfull', { psysonic_theme: 'imported' });
    const journal = JSON.parse(localStorage.getItem(FULL_BACKUP_IMPORT_JOURNAL_KEY) ?? '{}');
    journal.phase = 'prepared';
    localStorage.setItem(FULL_BACKUP_IMPORT_JOURNAL_KEY, JSON.stringify(journal));
    mocks.backupInspectFullImportRecovery.mockResolvedValue({
      status: 'ok',
      data: { phase: 'prepared', migrationGeneration: 7 },
    });

    await reconcileFullBackupImportRecovery();

    expect(mocks.backupRecoverFullImportDatabases).toHaveBeenCalledOnce();
    expect(mocks.libraryMigrationInspect).toHaveBeenCalledOnce();
    expect(mocks.invoke).not.toHaveBeenCalledWith('library_migration_release', expect.anything());
    expect(JSON.parse(localStorage.getItem('psysonic_theme') ?? 'null')).toBe('previous');
    expect(restoreRecoveryState).toHaveBeenCalledWith({ checkpoint: 'previous-checkpoint' });
    expect(localStorage.getItem(FULL_BACKUP_IMPORT_JOURNAL_KEY)).toBeNull();
    cleanup();
  });

  it('startup fails explicitly instead of releasing a different active generation', async () => {
    const cleanup = installImportedBackupCoordinator({
      arm: vi.fn(),
      disarm: vi.fn(),
      captureRecoveryState: () => ({}),
      restoreRecoveryState: vi.fn(),
      normalizeStores: stores => stores,
      prepareDatabaseImport: () => ({
        serverIds: [], canonicalServerIds: [], rollbackCheckpoint: vi.fn(),
      }),
    });
    await activateFullBackupOrRollback('/tmp/full.psyfull', { psysonic_theme: 'imported' });
    const journal = JSON.parse(localStorage.getItem(FULL_BACKUP_IMPORT_JOURNAL_KEY) ?? '{}');
    journal.phase = 'prepared';
    localStorage.setItem(FULL_BACKUP_IMPORT_JOURNAL_KEY, JSON.stringify(journal));
    mocks.libraryMigrationInspect.mockResolvedValue({
      status: 'ok',
      data: { state: 'active', generation: 8, servers: [] },
    });

    await expect(reconcileFullBackupImportRecovery())
      .rejects.toThrow('full_backup_import_active_generation_mismatch: persisted=7, active=8');

    expect(mocks.invoke).not.toHaveBeenCalledWith('library_migration_release', expect.anything());
    expect(localStorage.getItem(FULL_BACKUP_IMPORT_JOURNAL_KEY)).not.toBeNull();
    cleanup();
  });

  it('startup restores the database pair but blocks when the frontend journal is missing', async () => {
    const cleanup = installImportedBackupCoordinator({
      arm: vi.fn(),
      disarm: vi.fn(),
      captureRecoveryState: () => ({}),
      restoreRecoveryState: vi.fn(),
      normalizeStores: stores => stores,
      prepareDatabaseImport: () => ({
        serverIds: [], canonicalServerIds: [], rollbackCheckpoint: vi.fn(),
      }),
    });
    mocks.backupInspectFullImportRecovery.mockResolvedValue({
      status: 'ok',
      data: { phase: 'prepared', migrationGeneration: 7 },
    });

    await expect(reconcileFullBackupImportRecovery())
      .rejects.toThrow('full_backup_import_journal_missing_after_database_recovery');

    expect(mocks.backupRecoverFullImportDatabases).toHaveBeenCalledOnce();
    expect(mocks.backupFinalizeFullImportRecovery).not.toHaveBeenCalled();
    cleanup();
  });

  it('startup finalizes a committed marker without rolling back imported stores', async () => {
    const cleanup = installImportedBackupCoordinator({
      arm: vi.fn(),
      disarm: vi.fn(),
      captureRecoveryState: () => ({}),
      restoreRecoveryState: vi.fn(),
      normalizeStores: stores => stores,
      prepareDatabaseImport: () => ({
        serverIds: [], canonicalServerIds: [], rollbackCheckpoint: vi.fn(),
      }),
    });
    await activateFullBackupOrRollback('/tmp/full.psyfull', { psysonic_theme: 'imported' });
    mocks.backupInspectFullImportRecovery.mockResolvedValue({
      status: 'ok',
      data: { phase: 'committed', migrationGeneration: 7 },
    });

    await reconcileFullBackupImportRecovery();

    expect(mocks.backupFinalizeFullImportRecovery).toHaveBeenCalledOnce();
    expect(mocks.backupRecoverFullImportDatabases).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('psysonic_theme') ?? 'null')).toBe('imported');
    expect(localStorage.getItem(FULL_BACKUP_IMPORT_JOURNAL_KEY)).toBeNull();
    cleanup();
  });

  it('does not clear the activated journal when coordinator cleanup fails', async () => {
    const cleanup = installImportedBackupCoordinator({
      arm: vi.fn(),
      disarm: vi.fn(),
      captureRecoveryState: () => ({}),
      restoreRecoveryState: vi.fn(),
      normalizeStores: stores => stores,
      prepareDatabaseImport: () => ({
        serverIds: [], canonicalServerIds: [], rollbackCheckpoint: vi.fn(),
      }),
    });
    await activateFullBackupOrRollback('/tmp/full.psyfull', { psysonic_theme: 'imported' });
    mocks.backupCommitImportedDatabases.mockResolvedValue({
      status: 'error',
      error: 'injected cleanup failure',
    });

    await expect(commitImportedBackupRecovery()).rejects.toThrow('injected cleanup failure');

    expect(JSON.parse(localStorage.getItem(FULL_BACKUP_IMPORT_JOURNAL_KEY) ?? '{}').phase)
      .toBe('activated');
    cleanup();
  });
});

async function exportedConfigStores(): Promise<Record<string, unknown>> {
  await exportBackupToPath('config', '/tmp/settings.psybkp');
  const bytes = mocks.writeFile.mock.calls[mocks.writeFile.mock.calls.length - 1]?.[1] as Uint8Array;
  return (JSON.parse(new TextDecoder().decode(bytes)) as { stores: Record<string, unknown> }).stores;
}

describe('settings backup covers every setting', () => {
  it('brings back page layouts, the queue toolbar and the player bar after a clean start', async () => {
    const artistLayout = { state: { sections: [{ id: 'albums', visible: true }, { id: 'bio', visible: false }] }, version: 0 };
    const queueToolbar = { state: { buttons: [{ id: 'shuffle', visible: false }] }, version: 0 };
    const playerBar = { state: { trackInfoMode: 'titleAlbum' }, version: 0 };
    const favoritesLayout = { state: { sections: [{ id: 'songs', visible: true }] }, version: 0 };
    localStorage.setItem('psysonic_artist_layout', JSON.stringify(artistLayout));
    localStorage.setItem('psysonic_queue_toolbar', JSON.stringify(queueToolbar));
    localStorage.setItem('psysonic_player_bar_layout', JSON.stringify(playerBar));
    localStorage.setItem('psysonic_favorites_layout', JSON.stringify(favoritesLayout));

    const stores = await exportedConfigStores();
    localStorage.clear();
    restoreBackupStores(stores);

    expect(JSON.parse(localStorage.getItem('psysonic_artist_layout') ?? 'null')).toEqual(artistLayout);
    expect(JSON.parse(localStorage.getItem('psysonic_queue_toolbar') ?? 'null')).toEqual(queueToolbar);
    expect(JSON.parse(localStorage.getItem('psysonic_player_bar_layout') ?? 'null')).toEqual(playerBar);
    expect(JSON.parse(localStorage.getItem('psysonic_favorites_layout') ?? 'null')).toEqual(favoritesLayout);
  });

  it('records a setting that was never changed, so restoring the backup resets it', async () => {
    const stores = await exportedConfigStores();
    expect(stores).toHaveProperty('psysonic_artist_layout', null);
    // Keys every backup has carried keep their old shape: left out, not null.
    expect(stores).not.toHaveProperty('psysonic_home');

    localStorage.setItem('psysonic_artist_layout', JSON.stringify({ state: { sections: [] }, version: 0 }));
    restoreBackupStores(stores);

    expect(localStorage.getItem('psysonic_artist_layout')).toBeNull();
  });

  it('keeps settings that an older backup knew nothing about', () => {
    const folders = {
      state: { byServer: { 'music.test': { folders: [{ id: 'f1', name: 'Mixes' }], assignments: {} } } },
      version: 0,
    };
    localStorage.setItem('psysonic_playlist_folders', JSON.stringify(folders));
    localStorage.setItem('psysonic_radio_favorites', JSON.stringify(['music.test:st-1']));
    localStorage.setItem('psysonic-player', JSON.stringify({ state: { currentTrack: 'old' } }));

    restoreBackupStores({ psysonic_theme: 'dark' });

    expect(JSON.parse(localStorage.getItem('psysonic_playlist_folders') ?? 'null')).toEqual(folders);
    expect(JSON.parse(localStorage.getItem('psysonic_radio_favorites') ?? 'null')).toEqual(['music.test:st-1']);
    // A key every backup carries is still reset when the backup lacks it.
    expect(localStorage.getItem('psysonic-player')).toBeNull();
  });

  it('rolls back an interrupted import whose journal predates the added keys', async () => {
    localStorage.setItem('psysonic_theme', JSON.stringify('imported'));
    localStorage.setItem('psysonic_radio_favorites', JSON.stringify(['music.test:st-1']));
    localStorage.setItem(FULL_BACKUP_IMPORT_JOURNAL_KEY, JSON.stringify({
      version: 1,
      phase: 'prepared',
      migrationGeneration: null,
      previousStores: { psysonic_theme: JSON.stringify('previous'), 'psysonic-player': null },
      previousCoordinatorState: {},
    }));
    const cleanup = installImportedBackupCoordinator({
      arm: vi.fn(),
      disarm: vi.fn(),
      captureRecoveryState: () => ({}),
      restoreRecoveryState: vi.fn(),
      normalizeStores: stores => stores,
      prepareDatabaseImport: () => ({
        serverIds: [], canonicalServerIds: [], rollbackCheckpoint: vi.fn(),
      }),
    });

    await reconcileFullBackupImportRecovery();

    expect(JSON.parse(localStorage.getItem('psysonic_theme') ?? 'null')).toBe('previous');
    expect(JSON.parse(localStorage.getItem('psysonic_radio_favorites') ?? 'null')).toEqual(['music.test:st-1']);
    expect(localStorage.getItem(FULL_BACKUP_IMPORT_JOURNAL_KEY)).toBeNull();
    cleanup();
  });
});

/**
 * Stored keys that deliberately stay out of the backup, with the reason. Every
 * `psysonic_` / `psysonic-` storage key in the source has to be either backed up
 * or listed here, so a new setting cannot quietly go missing from backups again.
 */
const NOT_BACKED_UP = new Set<string>([
  // Mirrors files on disk, an attached device or the library databases.
  'psysonic-offline',
  'psysonic-local-playback',
  'psysonic-hot-cache',
  'psysonic-library-index',
  'psysonic_device_sync',
  'psysonic_burn_list',
  // Histories and caches that rebuild themselves.
  'psysonic_playlists_recent',
  'psysonic_recent_searches',
  'psysonic_theme_registry_cache',
  'psysonic-img-cache',
  'psysonic-lyrics-cache',
  'psysonic_because_anchor:',
  'psysonic_because_anchor_history:',
  'psysonic_because_picks:',
  // One-time migration markers, migration checkpoints and the import journal.
  'psysonic-cover-sources-external-off-v1',
  'psysonic-discord-server-cover-revival-v1',
  'psysonic-full-backup-import-journal-v1',
  'psysonic-linux-webkit-smooth-v1',
  'psysonic-local-playback-migrated-v1',
  'psysonic-max-cache-mb-removed-v1',
  'psysonic-music-network-migrated-v1',
  'psysonic-navidrome-canonical-bootstrap-active-v1',
  'psysonic-navidrome-canonical-id-migration-v1',
  'psysonic-server-key-migration-v1',
  'psysonic_advanced_mode_migrated',
  'psysonic_cover_tier_idb_cleared_v1',
  // Update prompts and panel state.
  'psysonic_skipped_update_version',
  'psysonic_theme_migration_notice',
  'psysonic_personalisation_advanced_open',
  // Developer diagnostics.
  'psysonic_perf_live_poll_ms_v1',
  'psysonic_perf_live_thread_groups_v1',
  'psysonic_perf_overlay_appearance_v1',
  'psysonic_perf_overlay_mode_v1',
  'psysonic_perf_overlay_pins_v1',
  'psysonic_perf_probe_flags_v1',
  'psysonic_psylab_debug_traces_v1',
  // Not a storage key.
  'psysonic-toast',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function storageKeyLiterals(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sourceFiles(join(process.cwd(), 'src'))) {
    if (file.endsWith(join('settings', 'utils', 'backup.ts'))) continue;
    for (const match of readFileSync(file, 'utf8').matchAll(/['"`](psysonic[-_][A-Za-z0-9_.:-]*)['"`]/g)) {
      // Rust paths quoted in comments are not storage keys.
      if (!match[1].includes('::')) found.set(match[1], file);
    }
  }
  return found;
}

describe('settings backup key coverage', () => {
  it('backs up or deliberately leaves out every stored psysonic key', () => {
    const backedUp = new Set<string>(BACKUP_KEYS);
    const unclassified = [...storageKeyLiterals()]
      .filter(([key]) => !backedUp.has(key) && !NOT_BACKED_UP.has(key))
      .map(([key, file]) => `${key} (${file})`);

    expect(unclassified).toEqual([]);
  }, 60_000);

  it('only backs up keys the app still uses, and never one it leaves out', () => {
    const used = storageKeyLiterals();

    expect(BACKUP_KEYS.filter(key => !used.has(key))).toEqual([]);
    expect(BACKUP_KEYS.filter(key => NOT_BACKED_UP.has(key))).toEqual([]);
  }, 60_000);
});
