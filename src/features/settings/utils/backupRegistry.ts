/**
 * One classified entry per persisted key, and the single source of truth for
 * what a backup carries.
 *
 * Before this registry the same knowledge lived in four places — two key
 * arrays and a raw-string set here, plus an exclusion list that only existed
 * inside the test file. A setting could be added to one and forgotten in the
 * others, which is how page layouts, the queue toolbar and the player bar went
 * missing from backups until #1625.
 *
 * Every persisted `psysonic` key has to appear here, either as a backed-up
 * entry or as a documented exclusion. `backup.test.ts` scans the source for
 * storage-key literals and fails when one is neither.
 */

/**
 * `legacy` — carried by every backup ever written. A backup without the key was
 * taken while the setting sat at its default, so restoring clears it.
 *
 * `added` — classified later. The export writes the key even when it is unset
 * (as `null`), so a restore can tell "default at backup time" (clear it) from
 * "this backup predates the key" (leave the current value alone). Clearing on
 * absence would throw away playlist folders or radio favourites that an older
 * backup simply knew nothing about.
 *
 * New entries are always `added`. Moving one to `legacy` would make older
 * backups start erasing it.
 */
export type BackupTier = 'legacy' | 'added';

/**
 * `json` — a serialized store, parsed on the way out and stringified back in.
 *
 * `raw-string` — a bare string. `JSON.parse` throws on it, so the export keeps
 * the raw value and the restore has to write it back raw as well. Sending one
 * through `JSON.stringify` adds literal quotes to the stored value, which is
 * how a language of `en` came back as `"en"` and made every `Intl` call built
 * from it throw (#1561).
 *
 * `projection` — only part of the store travels. Used where a store mixes
 * portable preferences with state bound to this machine (a mounted drive, a
 * device id). The entry supplies both directions of the transform.
 */
export type BackupStorageKind = 'json' | 'raw-string' | 'projection';

export type BackupProjection = {
  /** Reduce a stored value to the portable part, or `null` to carry nothing. */
  export: (stored: unknown) => unknown;
  /**
   * Fold a backed-up projection into what this machine currently holds. The
   * current value is `null` when the key is unset here.
   */
  merge: (projected: unknown, current: unknown) => unknown;
};

export type BackupEntry = {
  key: string;
  tier: BackupTier;
  storage: BackupStorageKind;
  /** Required when `storage` is `projection`. */
  projection?: BackupProjection;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Device Sync mixes a portable configuration with facts about the drive
 * attached to this machine.
 *
 * Portable: which albums, playlists and artists are selected, and how they are
 * laid out on disk. The sources carry `serverProfileId` alongside the
 * address-derived `serverIndexKey`, so an owner that lives at a different
 * address on the restoring machine is still recognised and followed (#1552).
 *
 * Not portable: `targetDir` and `targetDeviceId` name a drive that is not
 * attached here, `pendingDeletion` and the `synced*` pair describe what is
 * currently on that drive, and `legacy*` belongs to a repair flow bound to it.
 * Restoring any of those would point the feature at a device this machine has
 * never seen.
 *
 * The projection is written back at version 0 so Zustand runs the store's own
 * `migrate` on rehydrate. That sanitiser validates every source, reapplies the
 * playlist path ids and resets the transient selections — the restore does not
 * repeat those rules, it defers to them.
 */
const DEVICE_SYNC_PORTABLE_FIELDS = ['sources', 'layoutMode', 'playlistPathMode'] as const;

const deviceSyncProjection: BackupProjection = {
  export: (stored) => {
    if (!isObject(stored) || !isObject(stored.state)) return null;
    const state = stored.state;
    const portable: Record<string, unknown> = {};
    for (const field of DEVICE_SYNC_PORTABLE_FIELDS) {
      if (field in state) portable[field] = state[field];
    }
    if (Object.keys(portable).length === 0) return null;
    return { state: portable, version: 0 };
  },
  merge: (projected, current) => {
    // Anything this machine knows about its own drive stays; only the portable
    // fields come from the backup. A backup that carried none of them means the
    // selection was empty when it was taken, so they are cleared rather than
    // left behind — without touching the attached device.
    const currentState = isObject(current) && isObject(current.state) ? current.state : {};
    const projectedState = isObject(projected) && isObject(projected.state)
      ? projected.state
      : null;
    const merged: Record<string, unknown> = { ...currentState };
    for (const field of DEVICE_SYNC_PORTABLE_FIELDS) {
      if (projectedState && field in projectedState) merged[field] = projectedState[field];
      else delete merged[field];
    }
    return Object.keys(merged).length > 0 ? { state: merged, version: 0 } : null;
  },
};

export const BACKUP_REGISTRY: readonly BackupEntry[] = [
  { key: 'psysonic-auth', tier: 'legacy', storage: 'json' },
  { key: 'psysonic_theme', tier: 'legacy', storage: 'json' },
  { key: 'psysonic_font', tier: 'legacy', storage: 'json' },
  { key: 'psysonic_language', tier: 'legacy', storage: 'raw-string' },
  { key: 'psysonic_keybindings', tier: 'legacy', storage: 'json' },
  { key: 'psysonic_sidebar', tier: 'legacy', storage: 'json' },
  { key: 'psysonic-eq', tier: 'legacy', storage: 'json' },
  { key: 'psysonic_global_shortcuts', tier: 'legacy', storage: 'json' },
  { key: 'psysonic-player', tier: 'legacy', storage: 'json' },
  { key: 'psysonic_player_prefs', tier: 'legacy', storage: 'json' },
  { key: 'psysonic_queue_visible', tier: 'legacy', storage: 'json' },
  { key: 'psysonic_lastfm_loved_cache', tier: 'legacy', storage: 'json' },
  { key: 'psysonic_home', tier: 'legacy', storage: 'json' },
  { key: 'psysonic_visualizer', tier: 'legacy', storage: 'json' },
  { key: 'psysonic_np_layout', tier: 'legacy', storage: 'json' },

  { key: 'psysonic_artist_layout', tier: 'added', storage: 'json' },
  { key: 'psysonic_favorites_layout', tier: 'added', storage: 'json' },
  { key: 'psysonic_playlist_layout', tier: 'added', storage: 'json' },
  { key: 'psysonic_player_bar_layout', tier: 'added', storage: 'json' },
  { key: 'psysonic_queue_toolbar', tier: 'added', storage: 'json' },
  { key: 'psysonic_burner_layout', tier: 'added', storage: 'json' },
  { key: 'psysonic_album_view_mode', tier: 'added', storage: 'json' },
  { key: 'psysonic_artist_view_mode', tier: 'added', storage: 'json' },
  { key: 'psysonic_tracklist_columns', tier: 'added', storage: 'json' },
  { key: 'psysonic_favorites_columns', tier: 'added', storage: 'json' },
  { key: 'psysonic_playlist_columns', tier: 'added', storage: 'json' },
  { key: 'psysonic_artist_all_tracks_columns', tier: 'added', storage: 'json' },
  { key: 'psysonic_installed_themes', tier: 'added', storage: 'json' },
  { key: 'psysonic_share_settings', tier: 'added', storage: 'json' },
  { key: 'psysonic_play_queue_sync_settings', tier: 'added', storage: 'json' },
  { key: 'psysonic-playback-rate', tier: 'added', storage: 'json' },
  { key: 'psysonic-analytics-strategy', tier: 'added', storage: 'json' },
  { key: 'psysonic-cover-cache-strategy', tier: 'added', storage: 'json' },
  { key: 'psysonic_burn_settings', tier: 'added', storage: 'json' },
  { key: 'psysonic_radio_favorites', tier: 'added', storage: 'json' },
  { key: 'psysonic_radio_order', tier: 'added', storage: 'json' },
  { key: 'psysonic_playlist_folders', tier: 'added', storage: 'json' },
  { key: 'psysonic_shuffle_mode', tier: 'added', storage: 'json' },
  { key: 'psysonic_sidebar_collapsed', tier: 'added', storage: 'json' },
  { key: 'psysonic_mini_expanded_h', tier: 'added', storage: 'json' },
  { key: 'psysonic_mini_queue_open', tier: 'added', storage: 'json' },
  { key: 'psysonic_network_loved_cache', tier: 'added', storage: 'json' },
  {
    key: 'psysonic_device_sync',
    tier: 'added',
    storage: 'projection',
    projection: deviceSyncProjection,
  },
] as const;

/**
 * Persisted keys that deliberately stay out of a backup, with the reason.
 *
 * A key belongs here when restoring it would describe something that is not
 * true on the restoring machine — files it does not have, a migration it has
 * not run — or when it rebuilds itself anyway.
 */
export const BACKUP_EXCLUSIONS: Readonly<Record<string, string>> = {
  // Describe files on this disk or rows in the library databases. Restoring the
  // metadata without the files would claim downloads that are not there.
  'psysonic-offline': 'tracks downloaded to this machine',
  'psysonic-local-playback': 'local media paths on this machine',
  'psysonic-hot-cache': 'cache contents on this disk',
  'psysonic-library-index': 'mirrors the library databases',
  // A compilation being assembled for the next disc, not a setting. Its entries
  // address tracks by `${serverId}:${trackId}` and are not rewritten by the
  // canonical migration, so a restored list could point at ids that no longer
  // resolve.
  'psysonic_burn_list': 'work in progress for the next disc, not a setting',
  // Histories and caches that rebuild themselves.
  'psysonic_playlists_recent': 'history, rebuilds itself',
  'psysonic_recent_searches': 'history, and search terms are private',
  'psysonic_theme_registry_cache': 'store listing, refetched',
  'psysonic-img-cache': 'cache, refetched',
  'psysonic-lyrics-cache': 'cache, refetched',
  'psysonic_because_anchor:': 'derived recommendation state',
  'psysonic_because_anchor_history:': 'derived recommendation state',
  'psysonic_because_picks:': 'derived recommendation state',
  // Migration markers, checkpoints and the import journal. Restoring one would
  // tell this machine a migration already ran, or make a healthy install look
  // like it crashed mid-import.
  'psysonic-cover-sources-external-off-v1': 'one-time migration marker',
  'psysonic-discord-server-cover-revival-v1': 'one-time migration marker',
  'psysonic-full-backup-import-journal-v1': 'crash-recovery journal for the import itself',
  'psysonic-linux-webkit-smooth-v1': 'one-time migration marker',
  'psysonic-local-playback-migrated-v1': 'one-time migration marker',
  'psysonic-max-cache-mb-removed-v1': 'one-time migration marker',
  'psysonic-music-network-migrated-v1': 'one-time migration marker',
  'psysonic-navidrome-canonical-bootstrap-active-v1': 'migration lock for this machine',
  'psysonic-navidrome-canonical-id-migration-v1': 'one-time migration marker',
  'psysonic-server-key-migration-v1': 'one-time migration marker',
  'psysonic_advanced_mode_migrated': 'one-time migration marker',
  'psysonic_cover_tier_idb_cleared_v1': 'one-time migration marker',
  // Update prompts and panel state.
  'psysonic_skipped_update_version': 'a choice about one update of this install',
  'psysonic_theme_migration_notice': 'one-time notice',
  'psysonic_personalisation_advanced_open': 'panel open state',
  // Developer diagnostics.
  'psysonic_perf_live_poll_ms_v1': 'diagnostics',
  'psysonic_perf_live_thread_groups_v1': 'diagnostics',
  'psysonic_perf_overlay_appearance_v1': 'diagnostics',
  'psysonic_perf_overlay_mode_v1': 'diagnostics',
  'psysonic_perf_overlay_pins_v1': 'diagnostics',
  'psysonic_perf_probe_flags_v1': 'diagnostics',
  'psysonic_psylab_debug_traces_v1': 'diagnostics',
  // Not a storage key.
  'psysonic-toast': 'component id, not stored',
};

export const BACKUP_KEYS = BACKUP_REGISTRY.map(entry => entry.key);

const ENTRY_BY_KEY = new Map(BACKUP_REGISTRY.map(entry => [entry.key, entry] as const));

export function backupEntry(key: string): BackupEntry | undefined {
  return ENTRY_BY_KEY.get(key);
}

export function isBackupKey(key: string): boolean {
  return ENTRY_BY_KEY.has(key);
}

/** A key whose absence from a backup means "this setting was at its default". */
export function clearsWhenAbsent(key: string): boolean {
  return ENTRY_BY_KEY.get(key)?.tier === 'legacy';
}

export function isRawStringKey(key: string): boolean {
  return ENTRY_BY_KEY.get(key)?.storage === 'raw-string';
}

export function projectionFor(key: string): BackupProjection | null {
  const entry = ENTRY_BY_KEY.get(key);
  return entry?.storage === 'projection' ? entry.projection ?? null : null;
}
