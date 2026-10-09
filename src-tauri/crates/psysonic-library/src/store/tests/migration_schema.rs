use rusqlite::{params, Connection};

use super::super::migrations::{
    ensure_additive_schema, ensure_entity_user_rating_schema, ensure_genre_tags_schema,
    run_migrations, run_migrations_with, MigrationOutcome, INITIAL_SQL,
    LIBRARY_DB_MIN_COMPATIBLE_VERSION, MIGRATIONS, MIGRATION_012_TRACK_GENRE_LEGACY,
    MIGRATION_013_ARTIST_ARTWORK_LOOKUP, MIGRATION_014_ARTIST_NAME_SORT,
};
use super::super::open::{configure_write_connection, in_memory_uri};
use super::super::LibraryStore;
use super::migration_runner::no_op_hook;
use super::TestDatabase;

#[test]
fn migration_031_repairs_preexisting_version_30_without_mood_table() {
    let db = TestDatabase::new("mood-v30-marker-without-table");
    {
        let conn = Connection::open(&db.path).unwrap();
        configure_write_connection(&conn).unwrap();
        let through_29 = MIGRATIONS
            .iter()
            .copied()
            .filter(|(version, _)| *version <= 29)
            .collect::<Vec<_>>();
        run_migrations_with(
            &conn,
            &through_29,
            LIBRARY_DB_MIN_COMPATIBLE_VERSION,
            no_op_hook,
        )
        .unwrap();
        conn.execute(
            "INSERT INTO track (server_id, id, title, album, synced_at, raw_json) \
             VALUES ('s1', 't1', 'Existing track', 'Album', 1, '{\"moods\":[\"Dreamy\"]}')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO library_data_migration (id, cursor_rowid, started_at, completed_at) \
             VALUES (?1, 1, 1, 1)",
            [crate::mood_tags_backfill::MOOD_TAGS_MIGRATION_ID],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (30, 1)",
            [],
        )
        .unwrap();
    }

    let store = LibraryStore::open_path_for_test(&db.path).expect("repair mood schema on open");
    store
        .with_read_conn(|conn| {
            let (version, track_count, backfill_marker): (i64, i64, i64) = conn.query_row(
                "SELECT (SELECT MAX(version) FROM schema_migrations), \
                        (SELECT COUNT(*) FROM track WHERE id = 't1'), \
                        (SELECT COUNT(*) FROM library_data_migration WHERE id = ?1)",
                [crate::mood_tags_backfill::MOOD_TAGS_MIGRATION_ID],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
            assert_eq!((version, track_count, backfill_marker), (32, 1, 0));
            let mood_count: i64 =
                conn.query_row("SELECT COUNT(*) FROM track_mood", [], |row| row.get(0))?;
            assert_eq!(mood_count, 0);
            Ok(())
        })
        .unwrap();
    assert!(
        crate::mood_tags_backfill::inspect_mood_tags_backfill(&store)
            .unwrap()
            .needed
    );
    store.verify_operational_schema().unwrap();
}

#[test]
fn mood_schema_repair_on_reopen_invalidates_backfill_only_when_table_was_lost() {
    let db = TestDatabase::new("mood-repair-on-reopen");
    {
        let store = LibraryStore::open_path_for_test(&db.path).unwrap();
        store
            .with_conn_mut("test", |conn| {
                conn.execute(
                    "INSERT INTO track (server_id, id, title, album, synced_at, raw_json) \
                     VALUES ('s1', 't1', 'Existing track', 'Album', 1, '{\"moods\":[\"Dreamy\"]}')",
                    [],
                )?;
                conn.execute(
                    "INSERT INTO track_mood (server_id, track_id, mood) VALUES ('s1', 't1', 'Dreamy')",
                    [],
                )?;
                conn.execute(
                    "INSERT INTO library_data_migration (id, cursor_rowid, started_at, completed_at) \
                     VALUES (?1, 1, 1, 1)",
                    [crate::mood_tags_backfill::MOOD_TAGS_MIGRATION_ID],
                )?;
                conn.execute("DROP INDEX idx_track_mood_browse", [])?;
                Ok(())
            })
            .unwrap();
    }
    {
        let store = LibraryStore::open_path_for_test(&db.path).expect("restore missing index");
        store
            .with_read_conn(|conn| {
                let count: i64 = conn.query_row("SELECT COUNT(*) FROM track_mood", [], |row| {
                    row.get(0)
                })?;
                let marker: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM library_data_migration WHERE id = ?1 AND completed_at IS NOT NULL",
                    [crate::mood_tags_backfill::MOOD_TAGS_MIGRATION_ID],
                    |row| row.get(0),
                )?;
                assert_eq!((count, marker), (1, 1));
                Ok(())
            })
            .unwrap();
        store
            .with_conn_mut("test", |conn| {
                conn.execute("DROP TABLE track_mood", [])?;
                Ok(())
            })
            .unwrap();
    }
    let reopened = LibraryStore::open_path_for_test(&db.path).expect("restore missing table");
    assert!(
        crate::mood_tags_backfill::inspect_mood_tags_backfill(&reopened)
            .unwrap()
            .needed
    );
    reopened
        .with_read_conn(|conn| {
            let count: i64 =
                conn.query_row("SELECT COUNT(*) FROM track_mood", [], |row| row.get(0))?;
            assert_eq!(count, 0);
            Ok(())
        })
        .unwrap();
}

#[test]
fn additive_schema_guard_refuses_incompatible_existing_table_without_rewriting_it() {
    let conn = Connection::open_in_memory().unwrap();
    run_migrations(&conn).unwrap();
    conn.execute("DROP TABLE track_mood", []).unwrap();
    conn.execute("CREATE TABLE track_mood (server_id TEXT)", [])
        .unwrap();

    let error = ensure_additive_schema(&conn).unwrap_err().to_string();
    assert!(
        error.contains("incompatible library schema: track_mood"),
        "{error}"
    );
    let version: i64 = conn
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(version, 32);
    let columns: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('track_mood')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(columns, 1, "must not replace a conflicting user table");
}

#[test]
fn additive_schema_guard_rejects_an_index_with_the_right_name_but_wrong_definition() {
    let db = TestDatabase::new("mood-incompatible-index");
    {
        let store = LibraryStore::open_path_for_test(&db.path).unwrap();
        store
            .with_conn_mut("test", |conn| {
                conn.execute("DROP INDEX idx_track_mood_browse", [])?;
                conn.execute("CREATE INDEX idx_track_mood_browse ON track_mood(mood)", [])?;
                Ok(())
            })
            .unwrap();
    }

    let error = LibraryStore::open_path_for_test(&db.path)
        .err()
        .expect("incompatible index must stop open");
    assert!(
        error.contains("idx_track_mood_browse has an unexpected definition"),
        "{error}"
    );

    let conn = Connection::open(&db.path).unwrap();
    let sql: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE name = 'idx_track_mood_browse'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        sql,
        "CREATE INDEX idx_track_mood_browse ON track_mood(mood)"
    );
}

#[test]
fn additive_schema_guard_does_not_ignore_whitespace_inside_index_predicate() {
    let conn = Connection::open_in_memory().unwrap();
    run_migrations(&conn).unwrap();
    conn.execute("DROP INDEX idx_track_mood_browse", [])
        .unwrap();
    conn.execute(
        "CREATE INDEX idx_track_mood_browse \
         ON track_mood(server_id, mood COLLATE NOCASE, album_id, track_id) \
         WHERE album_id IS NOT NULL AND album_id != ' '",
        [],
    )
    .unwrap();

    let error = ensure_additive_schema(&conn).unwrap_err().to_string();
    assert!(
        error.contains("idx_track_mood_browse has an unexpected definition"),
        "{error}"
    );
}

#[test]
fn migration_030_refuses_incompatible_preexisting_table_before_modifying_it() {
    let conn = Connection::open_in_memory().unwrap();
    let through_29 = MIGRATIONS
        .iter()
        .copied()
        .filter(|(version, _)| *version <= 29)
        .collect::<Vec<_>>();
    run_migrations_with(
        &conn,
        &through_29,
        LIBRARY_DB_MIN_COMPATIBLE_VERSION,
        no_op_hook,
    )
    .unwrap();
    conn.execute("CREATE TABLE track_mood (server_id TEXT)", [])
        .unwrap();

    let error = run_migrations(&conn).unwrap_err().to_string();
    assert!(
        error.contains("incompatible library schema: track_mood"),
        "{error}"
    );
    let version: i64 = conn
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(version, 29);
    let index_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'idx_track_mood_browse'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(index_count, 0);
}

#[test]
fn migration_032_adds_label_projection_to_a_version_31_database() {
    let conn = Connection::open_in_memory().unwrap();
    let through_31 = MIGRATIONS
        .iter()
        .copied()
        .filter(|(version, _)| *version <= 31)
        .collect::<Vec<_>>();
    run_migrations_with(
        &conn,
        &through_31,
        LIBRARY_DB_MIN_COMPATIBLE_VERSION,
        no_op_hook,
    )
    .unwrap();
    let before: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name IN ('track_label', 'idx_track_label_browse')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(before, 0);

    run_migrations(&conn).unwrap();

    let (version, objects): (i64, i64) = conn
        .query_row(
            "SELECT (SELECT MAX(version) FROM schema_migrations), \
                    (SELECT COUNT(*) FROM sqlite_master \
                     WHERE name IN ('track_label', 'idx_track_label_browse'))",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!((version, objects), (32, 2));
    ensure_additive_schema(&conn).unwrap();
}

#[test]
fn label_schema_repair_on_reopen_invalidates_backfill_when_table_was_lost() {
    let db = TestDatabase::new("label-repair-on-reopen");
    {
        let store = LibraryStore::open_path_for_test(&db.path).unwrap();
        store
            .with_conn_mut("test", |conn| {
                conn.execute(
                    "INSERT INTO track (server_id, id, title, album, synced_at, raw_json) \
                     VALUES ('s1', 't1', 'Existing track', 'Album', 1, \
                             '{\"tags\":{\"recordlabel\":[\"Warp\"]}}')",
                    [],
                )?;
                conn.execute(
                    "INSERT INTO library_data_migration (id, cursor_rowid, started_at, completed_at) \
                     VALUES (?1, 1, 1, 1)",
                    [crate::label_tags_backfill::LABEL_TAGS_MIGRATION_ID],
                )?;
                conn.execute("DROP TABLE track_label", [])?;
                Ok(())
            })
            .unwrap();
    }
    let reopened = LibraryStore::open_path_for_test(&db.path).expect("restore missing table");
    assert!(
        crate::label_tags_backfill::inspect_label_tags_backfill(&reopened)
            .unwrap()
            .needed
    );
    reopened.verify_operational_schema().unwrap();
}

#[test]
fn migration_032_refuses_incompatible_preexisting_table_before_modifying_it() {
    let conn = Connection::open_in_memory().unwrap();
    let through_31 = MIGRATIONS
        .iter()
        .copied()
        .filter(|(version, _)| *version <= 31)
        .collect::<Vec<_>>();
    run_migrations_with(
        &conn,
        &through_31,
        LIBRARY_DB_MIN_COMPATIBLE_VERSION,
        no_op_hook,
    )
    .unwrap();
    conn.execute("CREATE TABLE track_label (server_id TEXT)", [])
        .unwrap();

    let error = run_migrations(&conn).unwrap_err().to_string();
    assert!(
        error.contains("incompatible library schema: track_label"),
        "{error}"
    );
    let version: i64 = conn
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(version, 31);
}

#[test]
fn migration_026_adds_tag_cursor_without_rewriting_completion_state() {
    let conn = Connection::open_in_memory().unwrap();
    let migrations_through_25 = MIGRATIONS
        .iter()
        .copied()
        .filter(|(version, _)| *version <= 25)
        .collect::<Vec<_>>();
    run_migrations_with(
        &conn,
        &migrations_through_25,
        LIBRARY_DB_MIN_COMPATIBLE_VERSION,
        super::migration_runner::no_op_hook,
    )
    .unwrap();
    conn.execute(
        "INSERT INTO library_tag_state \
         (server_id, folders_hash, last_untagged_count, completed_at) \
         VALUES ('s1', 'folders', 7, 123)",
        [],
    )
    .unwrap();

    run_migrations(&conn).unwrap();

    let state: (String, i64, i64) = conn
        .query_row(
            "SELECT folders_hash, last_untagged_count, completed_at \
             FROM library_tag_state WHERE server_id = 's1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(state, ("folders".into(), 7, 123));
    let cursor_table: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master \
             WHERE type = 'table' AND name = 'library_tag_cursor'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(cursor_table, 1);
}

#[test]
fn migration_027_adds_artist_star_and_sparse_browse_index_idempotently() {
    let conn = Connection::open_in_memory().unwrap();
    let migrations_through_26 = MIGRATIONS
        .iter()
        .copied()
        .filter(|(version, _)| *version <= 26)
        .collect::<Vec<_>>();
    run_migrations_with(
        &conn,
        &migrations_through_26,
        LIBRARY_DB_MIN_COMPATIBLE_VERSION,
        super::migration_runner::no_op_hook,
    )
    .unwrap();
    conn.execute(
        "INSERT INTO artist (server_id, id, name, name_sort, synced_at) \
         VALUES ('s1', 'ar1', 'Existing Artist', 'existing artist', 1)",
        [],
    )
    .unwrap();

    run_migrations(&conn).unwrap();
    run_migrations(&conn).unwrap();

    let (name, starred_at): (String, Option<i64>) = conn
        .query_row(
            "SELECT name, starred_at FROM artist WHERE server_id = 's1' AND id = 'ar1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(name, "Existing Artist");
    assert!(starred_at.is_none());

    let index_sql: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_artist_starred_name'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(index_sql.contains("artist(server_id, name_sort, id)"));
    assert!(index_sql.contains("WHERE starred_at IS NOT NULL"));
}

#[test]
fn migrations_028_and_029_add_artist_credit_projection_and_lookup_index() {
    let conn = Connection::open_in_memory().unwrap();
    let migrations_through_27 = MIGRATIONS
        .iter()
        .copied()
        .filter(|(version, _)| *version <= 27)
        .collect::<Vec<_>>();
    run_migrations_with(
        &conn,
        &migrations_through_27,
        LIBRARY_DB_MIN_COMPATIBLE_VERSION,
        super::migration_runner::no_op_hook,
    )
    .unwrap();

    run_migrations(&conn).unwrap();
    run_migrations(&conn).unwrap();

    let table_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master \
             WHERE type = 'table' AND name = 'artist_credit_projection'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(table_count, 1);
    let index_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master \
             WHERE type = 'index' AND name = 'idx_artist_credit_projection_artist_key'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(index_count, 1);
    let completed: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM library_data_migration \
             WHERE id = ?1 AND completed_at IS NOT NULL",
            params![crate::artist_credit_projection::MIGRATION_ID],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(completed, 1);
}

#[test]
fn fresh_database_marks_projection_backfills_complete() {
    let store = LibraryStore::open_in_memory();
    let completed: i64 = store
        .with_conn("test", |conn| {
            conn.query_row(
                "SELECT COUNT(*) FROM library_data_migration \
                  WHERE id IN (?1, ?2, ?3, ?4) AND completed_at IS NOT NULL",
                params![
                    crate::browse_projection::MIGRATION_ID,
                    crate::composer_projection::MIGRATION_ID,
                    crate::artist_credit_projection::MIGRATION_ID,
                    super::super::GENRE_CATALOG_PROJECTION_RECONCILE_ID,
                ],
                |row| row.get(0),
            )
        })
        .unwrap();
    assert_eq!(completed, 4);
}

#[test]
fn migration_012_repairs_db_that_recorded_legacy_versions_without_genre_tables() {
    let uri = in_memory_uri();
    let conn = Connection::open(&uri).expect("connection");
    configure_write_connection(&conn).expect("pragmas");
    conn.execute_batch(INITIAL_SQL).expect("initial");
    conn.execute("DROP TABLE IF EXISTS track_genre", [])
        .expect("drop track_genre");
    conn.execute("DROP TABLE IF EXISTS library_data_migration", [])
        .expect("drop cursor table");
    for version in 1..=11_i64 {
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?1)",
            params![version],
        )
        .expect("seed legacy versions");
    }

    let outcome = run_migrations_with(
        &conn,
        MIGRATIONS,
        LIBRARY_DB_MIN_COMPATIBLE_VERSION,
        no_op_hook,
    )
    .expect("apply v12 repair");
    assert_eq!(outcome, MigrationOutcome::Applied);
    ensure_genre_tags_schema(&conn).expect("ensure");

    for table in ["track_genre", "library_data_migration"] {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master \
                 WHERE type = 'table' AND name = ?1",
                params![table],
                |r| r.get(0),
            )
            .expect("table probe");
        assert_eq!(exists, 1, "missing table {table}");
    }
}

#[test]
fn migration_14_recovers_partial_schema_without_schema_migrations_row() {
    let uri = in_memory_uri();
    let conn = Connection::open(&uri).expect("connection");
    configure_write_connection(&conn).expect("pragmas");
    let migrations_through_13: &[(i64, &str)] = &[
        (1, INITIAL_SQL),
        (12, MIGRATION_012_TRACK_GENRE_LEGACY),
        (13, MIGRATION_013_ARTIST_ARTWORK_LOOKUP),
    ];
    run_migrations_with(
        &conn,
        migrations_through_13,
        LIBRARY_DB_MIN_COMPATIBLE_VERSION,
        no_op_hook,
    )
    .expect("migrate through v13");
    conn.execute_batch(MIGRATION_014_ARTIST_NAME_SORT)
        .expect("apply ddl only");

    let recorded: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = 14",
            [],
            |r| r.get(0),
        )
        .expect("count migration");
    assert_eq!(recorded, 0);

    run_migrations_with(
        &conn,
        MIGRATIONS,
        LIBRARY_DB_MIN_COMPATIBLE_VERSION,
        no_op_hook,
    )
    .expect("recover partial migration");

    let recorded_after: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = 14",
            [],
            |r| r.get(0),
        )
        .expect("count migration after");
    assert_eq!(recorded_after, 1);
}

#[test]
fn migration_22_recovers_partial_schema_without_schema_migrations_row() {
    let uri = in_memory_uri();
    let conn = Connection::open(&uri).expect("connection");
    configure_write_connection(&conn).expect("pragmas");
    let migrations_through_21: Vec<(i64, &str)> = MIGRATIONS
        .iter()
        .copied()
        .filter(|(version, _)| *version <= 21)
        .collect();
    run_migrations_with(
        &conn,
        &migrations_through_21,
        LIBRARY_DB_MIN_COMPATIBLE_VERSION,
        no_op_hook,
    )
    .expect("migrate through v21");
    conn.execute(
        "INSERT INTO artist (server_id, id, name, synced_at) VALUES ('s1', 'ar1', 'КИНО', 1)",
        [],
    )
    .expect("seed artist");
    conn.execute_batch("ALTER TABLE artist ADD COLUMN name_fold TEXT;")
        .expect("apply partial migration ddl");

    run_migrations_with(
        &conn,
        MIGRATIONS,
        LIBRARY_DB_MIN_COMPATIBLE_VERSION,
        no_op_hook,
    )
    .expect("recover partial migration");

    let recorded: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = 22",
            [],
            |row| row.get(0),
        )
        .expect("migration marker");
    assert_eq!(recorded, 1);
    let index_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_artist_name_fold'",
            [],
            |row| row.get(0),
        )
        .expect("index marker");
    assert_eq!(index_exists, 1);
    let name_fold: String = conn
        .query_row(
            "SELECT name_fold FROM artist WHERE server_id = 's1' AND id = 'ar1'",
            [],
            |row| row.get(0),
        )
        .expect("backfilled fold");
    assert_eq!(name_fold, "кино");
}

const LIBRARY_SCOPE_INDEXES: [&str; 4] = [
    "idx_track_library_album",
    "idx_track_library_artist",
    "idx_track_library_title",
    "idx_track_library_genre",
];

#[test]
fn migration_016_creates_library_scope_indexes() {
    let store = LibraryStore::open_in_memory();
    for index_name in LIBRARY_SCOPE_INDEXES {
        let exists: i64 = store
            .with_conn("misc", |c| {
                c.query_row(
                    "SELECT COUNT(*) FROM sqlite_master \
                     WHERE type = 'index' AND name = ?1",
                    params![index_name],
                    |r| r.get(0),
                )
            })
            .unwrap();
        assert_eq!(exists, 1, "missing index {index_name}");
    }
    let stat_rows: i64 = store
        .with_conn("misc", |c| {
            c.query_row("SELECT COUNT(*) FROM sqlite_stat1", [], |r| r.get(0))
        })
        .unwrap();
    assert!(stat_rows > 0, "ANALYZE should populate sqlite_stat1");
}

#[test]
fn migration_019_creates_mainstage_created_index() {
    let store = LibraryStore::open_in_memory();
    let sql: String = store
        .with_conn("test.mainstage_index", |conn| {
            conn.query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?1",
                params!["idx_track_library_created_album"],
                |row| row.get(0),
            )
        })
        .unwrap();
    assert!(sql.contains("server_id, library_id, server_created_at DESC, album_id, id"));
    assert!(sql.contains("server_created_at IS NOT NULL"));
}

#[test]
fn migration_019_creates_mainstage_rating_and_lossless_schema_idempotently() {
    let store = LibraryStore::open_in_memory();
    let version: i64 = store
        .with_conn("test.entity_user_rating_version", |conn| {
            conn.query_row(
                "SELECT version FROM schema_migrations WHERE version = 19",
                [],
                |row| row.get(0),
            )
        })
        .unwrap();
    assert_eq!(version, 19);

    store
        .with_conn(
            "test.entity_user_rating_ensure",
            ensure_entity_user_rating_schema,
        )
        .expect("repeated schema repair succeeds");
    let table_count: i64 = store
        .with_conn("test.entity_user_rating_table", |conn| {
            conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'entity_user_rating'",
                [],
                |row| row.get(0),
            )
        })
        .unwrap();
    assert_eq!(table_count, 1);

    let index_count: i64 = store
        .with_conn("test.lossless_browse_index", |conn| {
            conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_track_lossless_album_browse'",
                [],
                |row| row.get(0),
            )
        })
        .unwrap();
    assert_eq!(index_count, 1);
}
