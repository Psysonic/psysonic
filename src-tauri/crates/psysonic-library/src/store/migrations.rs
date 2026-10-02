use rusqlite::{params, Connection, OptionalExtension};

use super::reconciles::{
    artist_name_fold_column_exists, artist_name_sort_column_exists, finish_migration_14_reconcile,
    maybe_reconcile_artist_name_fold, sync_state_ignored_articles_column_exists,
};

/// Current head of the embedded migrations. Bump each time a new
/// `migrations/NNN_*.sql` is added.
///
/// Migration checklist (wiring, data backfill, open/swap path):
/// psysonic-workdocs `ai/agent-rules/08-library-db-migrations.md`.
pub const LIBRARY_DB_SCHEMA_VERSION: i64 = 32;

/// Lowest applied schema version the current code can advance from purely
/// additively. If a DB carries a version below this, the breaking-bump hook
/// fires (spec §5.7 / P22): the library is treated as incompatible, must be
/// dropped, and initial sync must restart.
///
/// At v1 launch this equals `LIBRARY_DB_SCHEMA_VERSION` — no real DB can
/// trip the hook. Bump independently of `SCHEMA_VERSION` only when a
/// migration cannot be expressed additively.
pub const LIBRARY_DB_MIN_COMPATIBLE_VERSION: i64 = 1;

pub(crate) const INITIAL_SQL: &str = include_str!("../../migrations/001_initial.sql");
/// Version 12 is above the removed legacy migrations 002–011 so existing DBs
/// still pick up `track_genre` + `library_data_migration`.
pub(crate) const MIGRATION_012_TRACK_GENRE_LEGACY: &str =
    include_str!("../../migrations/012_track_genre_legacy_repair.sql");
/// Version 13: additive `artist_artwork_lookup` table for external artist
/// artwork (fanart.tv) — image-scraper §12. Pure CREATE TABLE IF NOT EXISTS.
pub(crate) const MIGRATION_013_ARTIST_ARTWORK_LOOKUP: &str =
    include_str!("../../migrations/013_artist_artwork_lookup.sql");
pub(crate) const MIGRATION_014_ARTIST_NAME_SORT: &str =
    include_str!("../../migrations/014_artist_name_sort.sql");
pub(crate) const MIGRATION_015_REPLAY_GAIN_PEAK: &str =
    include_str!("../../migrations/015_replay_gain_peak.sql");
pub(crate) const MIGRATION_016_MULTI_LIBRARY_SCOPE: &str =
    include_str!("../../migrations/016_multi_library_scope.sql");
pub(crate) const MIGRATION_017_LIBRARY_TAG_STATE: &str =
    include_str!("../../migrations/017_library_tag_state.sql");
/// Version 18: additive `idx_artist_synced(server_id, synced_at)` so the orphan
/// prune's freshness lookup is an index seek instead of a per-server scan.
pub(crate) const MIGRATION_018_ARTIST_SYNCED_INDEX: &str =
    include_str!("../../migrations/018_artist_synced_index.sql");
/// Version 19: Mainstage feed indexes, owner-scoped rating cache, and a
/// suffix-selective lossless browse index.
pub(crate) const MIGRATION_019_MAINSTAGE_FEED_INDEXES: &str =
    include_str!("../../migrations/019_mainstage_feed_indexes.sql");
/// Version 20: materialized per-library album rows for keyset scope browse.
pub(crate) const MIGRATION_020_SCOPE_BROWSE_PROJECTION: &str =
    include_str!("../../migrations/020_scope_browse_projection.sql");
/// Version 21: title keyset index for candidate-first scoped track browse.
pub(crate) const MIGRATION_021_SCOPE_BROWSE_TRACKS: &str =
    include_str!("../../migrations/021_scope_browse_tracks.sql");
pub(crate) const MIGRATION_022_ARTIST_NAME_FOLD: &str =
    include_str!("../../migrations/022_artist_name_fold.sql");
/// Version 23: partial index for the Favorites initial local snapshot.
pub(crate) const MIGRATION_023_STARRED_BROWSE_INDEXES: &str =
    include_str!("../../migrations/023_starred_browse_indexes.sql");
/// Version 24: materialized composer credits by library and album.
pub(crate) const MIGRATION_024_COMPOSER_BROWSE_PROJECTION: &str =
    include_str!("../../migrations/024_composer_browse_projection.sql");
/// Version 25: durable invalidation journal for incremental identity maintenance.
pub(crate) const MIGRATION_025_IDENTITY_INVALIDATION: &str =
    include_str!("../../migrations/025_identity_invalidation.sql");
/// Version 26: resumable cursor for bounded post-sync library tagging.
pub(crate) const MIGRATION_026_LIBRARY_TAG_CURSOR: &str =
    include_str!("../../migrations/026_library_tag_cursor.sql");
/// Version 27: persisted artist favorites and sparse alphabetical browse index.
pub(crate) const MIGRATION_027_ARTIST_STARRED: &str =
    include_str!("../../migrations/027_artist_starred.sql");
/// Version 28: indexed OpenSubsonic track/album artist credits.
pub(crate) const MIGRATION_028_ARTIST_CREDIT_PROJECTION: &str =
    include_str!("../../migrations/028_artist_credit_projection.sql");
/// Version 29: candidate-first structured-credit lookup by normalized artist key.
pub(crate) const MIGRATION_029_ARTIST_CREDIT_KEY_INDEX: &str =
    include_str!("../../migrations/029_artist_credit_key_index.sql");
/// Version 30: normalized OpenSubsonic MOOD/TMOO tags for local mood browsing.
pub(crate) const MIGRATION_030_TRACK_MOOD: &str =
    include_str!("../../migrations/030_track_mood.sql");
/// Version 31: safe repair when an older local DB already recorded version 30
/// without creating the mood projection.
pub(crate) const MIGRATION_031_TRACK_MOOD_SCHEMA_REPAIR: &str =
    include_str!("../../migrations/031_track_mood_schema_repair.sql");
/// Version 32: normalized record labels for local label browsing.
pub(crate) const MIGRATION_032_TRACK_LABEL: &str =
    include_str!("../../migrations/032_track_label.sql");

/// Embedded migrations. Ordered ascending by `version`; the runner sorts
/// defensively before applying so the source order can stay readable.
pub(super) const MIGRATIONS: &[(i64, &str)] = &[
    (1, INITIAL_SQL),
    (12, MIGRATION_012_TRACK_GENRE_LEGACY),
    (13, MIGRATION_013_ARTIST_ARTWORK_LOOKUP),
    (14, MIGRATION_014_ARTIST_NAME_SORT),
    (15, MIGRATION_015_REPLAY_GAIN_PEAK),
    (16, MIGRATION_016_MULTI_LIBRARY_SCOPE),
    (17, MIGRATION_017_LIBRARY_TAG_STATE),
    (18, MIGRATION_018_ARTIST_SYNCED_INDEX),
    (19, MIGRATION_019_MAINSTAGE_FEED_INDEXES),
    (20, MIGRATION_020_SCOPE_BROWSE_PROJECTION),
    (21, MIGRATION_021_SCOPE_BROWSE_TRACKS),
    (22, MIGRATION_022_ARTIST_NAME_FOLD),
    (23, MIGRATION_023_STARRED_BROWSE_INDEXES),
    (24, MIGRATION_024_COMPOSER_BROWSE_PROJECTION),
    (25, MIGRATION_025_IDENTITY_INVALIDATION),
    (26, MIGRATION_026_LIBRARY_TAG_CURSOR),
    (27, MIGRATION_027_ARTIST_STARRED),
    (28, MIGRATION_028_ARTIST_CREDIT_PROJECTION),
    (29, MIGRATION_029_ARTIST_CREDIT_KEY_INDEX),
    (30, MIGRATION_030_TRACK_MOOD),
    (31, MIGRATION_031_TRACK_MOOD_SCHEMA_REPAIR),
    (32, MIGRATION_032_TRACK_LABEL),
];

/// Additive schema invariants that can be restored without rewriting user data.
/// Register future CREATE-only migrations here rather than replaying arbitrary
/// historical migrations when their version markers disagree with the schema.
struct AdditiveSchemaGuard {
    table: &'static str,
    columns: &'static [(&'static str, &'static str, i64, i64)],
    table_constraints: &'static [&'static str],
    index: &'static str,
    index_columns: &'static str,
    index_predicate: &'static str,
    repair_sql: &'static str,
    backfill_id: Option<&'static str>,
}

const TRACK_MOOD_GUARD: AdditiveSchemaGuard = AdditiveSchemaGuard {
    table: "track_mood",
    columns: &[
        ("server_id", "TEXT", 1, 1),
        ("track_id", "TEXT", 1, 2),
        ("mood", "TEXT", 1, 3),
        ("album_id", "TEXT", 0, 0),
        ("library_id", "TEXT", 0, 0),
    ],
    table_constraints: &[
        "primarykey(server_id,track_id,moodcollatenocase)",
        "foreignkey(server_id,track_id)referencestrack(server_id,id)ondeletecascade",
    ],
    index: "idx_track_mood_browse",
    index_columns: "ontrack_mood(server_id,moodcollatenocase,album_id,track_id)",
    index_predicate: "wherealbum_idisnotnullandalbum_id!=''",
    repair_sql: MIGRATION_031_TRACK_MOOD_SCHEMA_REPAIR,
    backfill_id: Some(crate::mood_tags_backfill::MOOD_TAGS_MIGRATION_ID),
};

const TRACK_LABEL_GUARD: AdditiveSchemaGuard = AdditiveSchemaGuard {
    table: "track_label",
    columns: &[
        ("server_id", "TEXT", 1, 1),
        ("track_id", "TEXT", 1, 2),
        ("label", "TEXT", 1, 3),
        ("album_id", "TEXT", 0, 0),
        ("library_id", "TEXT", 0, 0),
    ],
    table_constraints: &[
        "primarykey(server_id,track_id,labelcollatenocase)",
        "foreignkey(server_id,track_id)referencestrack(server_id,id)ondeletecascade",
    ],
    index: "idx_track_label_browse",
    index_columns: "ontrack_label(server_id,labelcollatenocase,album_id,track_id)",
    index_predicate: "wherealbum_idisnotnullandalbum_id!=''",
    repair_sql: MIGRATION_032_TRACK_LABEL,
    backfill_id: Some(crate::label_tags_backfill::LABEL_TAGS_MIGRATION_ID),
};

const ADDITIVE_SCHEMA_GUARDS: &[&AdditiveSchemaGuard] = &[&TRACK_MOOD_GUARD, &TRACK_LABEL_GUARD];

#[derive(PartialEq, Eq)]
enum AdditiveSchemaState {
    Complete,
    MissingTable,
    MissingIndex,
}

fn compact_schema_sql(sql: &str) -> String {
    let mut compact = String::with_capacity(sql.len());
    let mut in_string = false;
    for ch in sql.chars() {
        if ch == '\'' {
            in_string = !in_string;
            compact.push(ch);
        } else if in_string {
            // Whitespace inside an SQL literal is data, not formatting.
            compact.push(ch);
        } else if !ch.is_whitespace() {
            compact.extend(ch.to_lowercase());
        }
    }
    compact
}

fn incompatible_schema(detail: &str) -> rusqlite::Error {
    rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_SCHEMA),
        Some(format!(
            "incompatible library schema: {detail}; refusing automatic repair"
        )),
    )
}

fn validate_additive_schema_guard(
    conn: &Connection,
    guard: &AdditiveSchemaGuard,
) -> rusqlite::Result<AdditiveSchemaState> {
    let table: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT type, sql FROM sqlite_master WHERE name = ?1",
            [guard.table],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((table_type, table_sql)) = &table {
        if table_type != "table" {
            return Err(incompatible_schema(&format!(
                "{} is a {table_type}, expected a table",
                guard.table
            )));
        }

        let mut stmt = conn.prepare(&format!("PRAGMA table_xinfo({})", guard.table))?;
        let actual = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let expected: Vec<(String, String, i64, Option<String>, i64, i64)> = guard
            .columns
            .iter()
            .map(|(name, ty, not_null, pk)| {
                (name.to_string(), ty.to_string(), *not_null, None, *pk, 0)
            })
            .collect();
        let compact_sql = compact_schema_sql(table_sql.as_deref().unwrap_or_default());
        if actual != expected
            || guard
                .table_constraints
                .iter()
                .any(|constraint| !compact_sql.contains(constraint))
        {
            return Err(incompatible_schema(&format!(
                "{} has unexpected columns, primary key or foreign key",
                guard.table
            )));
        }
    }

    let index: Option<(String, String, Option<String>)> = conn
        .query_row(
            "SELECT type, tbl_name, sql FROM sqlite_master WHERE name = ?1",
            [guard.index],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    if let Some((object_type, index_table, index_sql)) = &index {
        let compact_sql = compact_schema_sql(index_sql.as_deref().unwrap_or_default());
        if object_type != "index"
            || index_table != guard.table
            || !compact_sql.contains(guard.index_columns)
            || !compact_sql.contains(guard.index_predicate)
        {
            return Err(incompatible_schema(&format!(
                "{} has an unexpected definition",
                guard.index
            )));
        }
    }
    Ok(if table.is_none() {
        AdditiveSchemaState::MissingTable
    } else if index.is_none() {
        AdditiveSchemaState::MissingIndex
    } else {
        AdditiveSchemaState::Complete
    })
}

/// Run only CREATE-only repairs on startup, including when the migration
/// marker is present but an object is missing. Never reset version markers or
/// replay data-changing migrations to guess what happened on a user's DB.
pub(crate) fn ensure_additive_schema(conn: &Connection) -> rusqlite::Result<()> {
    ensure_additive_schema_guards(conn, ADDITIVE_SCHEMA_GUARDS)
}

fn ensure_additive_schema_guards(
    conn: &Connection,
    guards: &[&AdditiveSchemaGuard],
) -> rusqlite::Result<()> {
    for guard in guards {
        let state = validate_additive_schema_guard(conn, guard)?;
        if state == AdditiveSchemaState::Complete {
            continue;
        }
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(guard.repair_sql)?;
        if validate_additive_schema_guard(&tx, guard)? != AdditiveSchemaState::Complete {
            return Err(incompatible_schema(&format!(
                "{} repair did not create the required table and index",
                guard.table
            )));
        }
        if state == AdditiveSchemaState::MissingTable {
            if let Some(backfill_id) = guard.backfill_id {
                // A completed marker is not valid after recreating its derived
                // table; the normal blocking backfill will repopulate it. A
                // missing legacy migration-state table has no marker to reset.
                let has_migration_state: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_master \
                     WHERE type = 'table' AND name = 'library_data_migration')",
                    [],
                    |row| row.get(0),
                )?;
                if has_migration_state {
                    tx.execute(
                        "DELETE FROM library_data_migration WHERE id = ?1",
                        [backfill_id],
                    )?;
                }
            }
        }
        tx.commit()?;
    }
    Ok(())
}

/// Validate without mutating the DB (used after open and before a backup swap).
pub(crate) fn verify_additive_schema(conn: &Connection) -> rusqlite::Result<()> {
    for guard in ADDITIVE_SCHEMA_GUARDS {
        if validate_additive_schema_guard(conn, guard)? != AdditiveSchemaState::Complete {
            return Err(incompatible_schema(&format!(
                "{} or {} is missing",
                guard.table, guard.index
            )));
        }
    }
    Ok(())
}

/// Idempotent repair — also runs after the migration runner on every open so
/// DBs that recorded the wrong version numbers still get the tables.
pub(crate) fn ensure_genre_tags_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(MIGRATION_012_TRACK_GENRE_LEGACY)
}

/// Repairs the rare partial-v19 state where the migration marker was recorded
/// but its additive index did not survive. `CREATE INDEX IF NOT EXISTS` leaves
/// healthy databases and all user library data untouched.
pub(crate) fn ensure_mainstage_feed_indexes(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(MIGRATION_019_MAINSTAGE_FEED_INDEXES)
}

/// Repairs a partial-v19 state where its additive indexes or ratings cache did
/// not survive despite the migration marker being recorded.
pub(crate) fn ensure_entity_user_rating_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(MIGRATION_019_MAINSTAGE_FEED_INDEXES)
}

pub(crate) fn ensure_scope_browse_projection_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(MIGRATION_020_SCOPE_BROWSE_PROJECTION)
}

pub(crate) fn ensure_composer_browse_projection_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(MIGRATION_024_COMPOSER_BROWSE_PROJECTION)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MigrationOutcome {
    /// Every missing migration was applied (or the DB was already at head).
    Applied,
    /// The DB carried a schema below `LIBRARY_DB_MIN_COMPATIBLE_VERSION`,
    /// so the breaking-bump hook fired. Callers should treat the library
    /// data as discarded and trigger a fresh initial sync (P22).
    BreakingBump,
}

pub(super) fn run_migrations(conn: &Connection) -> rusqlite::Result<MigrationOutcome> {
    run_migrations_with(
        conn,
        MIGRATIONS,
        LIBRARY_DB_MIN_COMPATIBLE_VERSION,
        handle_breaking_schema_bump,
    )
}

fn mark_projection_migration_complete_if_empty(
    conn: &Connection,
    migration_id: &str,
) -> rusqlite::Result<()> {
    let required_tables: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('track', 'library_data_migration')",
        [],
        |row| row.get(0),
    )?;
    if required_tables != 2 {
        return Ok(());
    }
    let has_live_tracks: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM track WHERE deleted = 0)",
        [],
        |row| row.get(0),
    )?;
    if has_live_tracks {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO library_data_migration (id, cursor_rowid, started_at, completed_at) \
         VALUES (?1, 0, strftime('%s','now'), strftime('%s','now')) \
         ON CONFLICT(id) DO UPDATE SET completed_at = excluded.completed_at",
        params![migration_id],
    )?;
    Ok(())
}

/// Test-friendly entry point. Production code goes through `run_migrations`,
/// which fixes `migrations`, `min_compatible`, and `hook` to the prod values.
pub(crate) fn run_migrations_with(
    conn: &Connection,
    migrations: &[(i64, &str)],
    min_compatible: i64,
    hook: fn(&Connection, i64, i64) -> rusqlite::Result<()>,
) -> rusqlite::Result<MigrationOutcome> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
           version    INTEGER PRIMARY KEY,
           applied_at INTEGER NOT NULL
         );",
    )?;

    // Breaking-bump detection only meaningful for already-initialised DBs.
    let max_applied: Option<i64> =
        conn.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get::<_, Option<i64>>(0)
        })?;
    if let Some(max_applied) = max_applied {
        if max_applied < min_compatible {
            hook(conn, max_applied, LIBRARY_DB_SCHEMA_VERSION)?;
            return Ok(MigrationOutcome::BreakingBump);
        }
    }

    let mut ordered: Vec<(i64, &str)> = migrations.iter().map(|(v, s)| (*v, *s)).collect();
    ordered.sort_by_key(|(v, _)| *v);
    for (version, sql) in ordered {
        let already: i64 = conn.query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
            params![version],
            |row| row.get(0),
        )?;
        if already > 0 {
            continue;
        }
        if version == 14 {
            // Applied idempotently (per-column ADD + IF NOT EXISTS index) so a
            // partial DDL apply — one ALTER landed before a crash, no
            // schema_migrations row — recovers instead of failing on a
            // duplicate-column re-run of the batch.
            apply_migration_14(conn)?;
            record_schema_migration(conn, version)?;
            continue;
        }
        if version == 22 {
            apply_migration_22(conn)?;
            record_schema_migration(conn, version)?;
            continue;
        }
        if version == 30 {
            // CREATE TABLE IF NOT EXISTS must not silently accept an older,
            // incompatible object and then build an index on it.
            validate_additive_schema_guard(conn, &TRACK_MOOD_GUARD)?;
        }
        if version == 32 {
            validate_additive_schema_guard(conn, &TRACK_LABEL_GUARD)?;
        }
        if version == 31 {
            // Only the mood repair belongs to version 31; later guards are
            // created by their own migration and by the open-time repair.
            ensure_additive_schema_guards(conn, &[&TRACK_MOOD_GUARD])?;
            record_schema_migration(conn, version)?;
            continue;
        }
        conn.execute_batch(sql)?;
        match version {
            20 => mark_projection_migration_complete_if_empty(
                conn,
                crate::browse_projection::MIGRATION_ID,
            )?,
            24 => mark_projection_migration_complete_if_empty(
                conn,
                crate::composer_projection::MIGRATION_ID,
            )?,
            28 => mark_projection_migration_complete_if_empty(
                conn,
                crate::artist_credit_projection::MIGRATION_ID,
            )?,
            _ => {}
        }
        record_schema_migration(conn, version)?;
    }
    Ok(MigrationOutcome::Applied)
}

/// Apply schema 014 idempotently — mirrors `migrations/014_artist_name_sort.sql`
/// but tolerates a partial prior apply (missing one column / re-run).
fn apply_migration_14(conn: &Connection) -> rusqlite::Result<()> {
    if !artist_name_sort_column_exists(conn)? {
        conn.execute_batch("ALTER TABLE artist ADD COLUMN name_sort TEXT;")?;
    }
    if !sync_state_ignored_articles_column_exists(conn)? {
        conn.execute_batch("ALTER TABLE sync_state ADD COLUMN ignored_articles TEXT;")?;
    }
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_artist_name_sort ON artist(server_id, name_sort);",
    )?;
    finish_migration_14_reconcile(conn)?;
    Ok(())
}

/// Apply schema 022 idempotently so a crash after `ADD COLUMN` can recover.
fn apply_migration_22(conn: &Connection) -> rusqlite::Result<()> {
    if !artist_name_fold_column_exists(conn)? {
        conn.execute_batch("ALTER TABLE artist ADD COLUMN name_fold TEXT;")?;
    }
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_artist_name_fold ON artist(server_id, name_fold);",
    )?;
    maybe_reconcile_artist_name_fold(conn)?;
    Ok(())
}

fn record_schema_migration(conn: &Connection, version: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, strftime('%s','now'))",
        params![version],
    )?;
    Ok(())
}

/// P22 breaking-schema-bump hook. PR-1b ships a no-op stub: the function
/// signature, call site, and `MigrationOutcome::BreakingBump` signal are in
/// place, but the actual library-drop + sync-reset logic lands when the
/// first real breaking bump happens. Until then the constants guarantee the
/// hook never fires on production data.
pub(super) fn handle_breaking_schema_bump(
    _conn: &Connection,
    _max_applied: i64,
    _target_version: i64,
) -> rusqlite::Result<()> {
    Ok(())
}
