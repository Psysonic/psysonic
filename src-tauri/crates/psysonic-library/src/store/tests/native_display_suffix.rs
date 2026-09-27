use rusqlite::{params, Connection};

use super::super::native_display_suffix_reconcile::{
    maybe_reconcile_native_display_suffix_backfill, NATIVE_DISPLAY_SUFFIX_BACKFILL_RECONCILE_ID,
};
use super::super::{LibraryBackfillStep, LibraryStore};

fn seed_track(
    conn: &Connection,
    id: &str,
    title: &str,
    album: &str,
    deleted: i64,
    raw_json: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO track (server_id, id, title, album, album_id, library_id, duration_sec, \
           deleted, synced_at, raw_json) \
         VALUES ('s1', ?1, ?2, ?3, 'al-' || ?1, 'lib', 1, ?4, 1, ?5)",
        params![id, title, album, deleted, raw_json],
    )
}

fn mark_navidrome_native(conn: &Connection, server_id: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO sync_state (server_id, library_scope, capability_flags) VALUES (?1, '', 1)",
        params![server_id],
    )
}

/// A row from a Subsonic server without the Navidrome native capability.
fn seed_subsonic_server_track(conn: &Connection, raw_json: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO track (server_id, id, title, album, album_id, library_id, duration_sec, \
           deleted, synced_at, raw_json) \
         VALUES ('s2', 'subsonic', 'Song', 'Album', 'al-s2', 'lib', 1, 0, 1, ?1)",
        params![raw_json],
    )
}

fn subsonic_server_names(store: &LibraryStore) -> (String, String) {
    store
        .with_read_conn(|conn| {
            conn.query_row(
                "SELECT title, album FROM track WHERE server_id = 's2'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
        })
        .expect("subsonic server row")
}

#[test]
fn native_display_suffix_backfill_appends_tags_once_and_invalidates_changed_rows() {
    type TextRow = (String, String, String);

    let store = LibraryStore::open_in_memory();
    store
        .with_conn_mut("test.seed_display_suffix", |conn| {
            mark_navidrome_native(conn, "s1")?;
            seed_track(
                conn,
                "subtitle",
                "Song",
                "Album",
                0,
                r#"{"updatedAt":"2026-01-01T00:00:00Z","tags":{"subtitle":["Instrumental"]}}"#,
            )?;
            seed_track(
                conn,
                "version",
                "Song",
                "Album",
                0,
                r#"{"updatedAt":"2026-01-01T00:00:00Z","albumVersion":"Deluxe","tags":{"albumversion":["Deluxe"]}}"#,
            )?;
            // Arrived through the Subsonic API, which already appended both.
            seed_track(
                conn,
                "subsonic",
                "Song (Instrumental)",
                "Album (Deluxe)",
                0,
                r#"{"tags":{"subtitle":["Instrumental"],"albumversion":["Deluxe"]}}"#,
            )?;
            // Another Subsonic server's row keeps the bare names it states, even
            // with `updatedAt` and tags in its JSON.
            seed_subsonic_server_track(
                conn,
                r#"{"title":"Song","album":"Album","updatedAt":"2026-01-01T00:00:00Z","tags":{"subtitle":["Live"],"albumversion":["Deluxe"]}}"#,
            )?;
            seed_track(
                conn,
                "plain",
                "Song",
                "Album",
                0,
                r#"{"updatedAt":"2026-01-01T00:00:00Z","tags":{"genre":["Ambient"]}}"#,
            )?;
            seed_track(
                conn,
                "tombstone",
                "Song",
                "Album",
                1,
                r#"{"updatedAt":"2026-01-01T00:00:00Z","tags":{"subtitle":["Instrumental"]}}"#,
            )?;
            Ok(())
        })
        .expect("seed tracks");

    store
        .with_conn(
            "test.display_suffix_backfill",
            maybe_reconcile_native_display_suffix_backfill,
        )
        .expect("display-suffix backfill");

    let rows: Vec<TextRow> = store
        .with_read_conn(|conn| {
            conn.prepare("SELECT id, title, album FROM track WHERE server_id = 's1' ORDER BY id")?
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
                .collect()
        })
        .expect("backfilled rows");
    assert_eq!(
        rows,
        vec![
            ("plain".into(), "Song".into(), "Album".into()),
            (
                "subsonic".into(),
                "Song (Instrumental)".into(),
                "Album (Deluxe)".into()
            ),
            (
                "subtitle".into(),
                "Song (Instrumental)".into(),
                "Album".into()
            ),
            ("tombstone".into(), "Song".into(), "Album".into()),
            ("version".into(), "Song".into(), "Album (Deluxe)".into()),
        ]
    );

    let invalidated: Vec<(String, String)> = store
        .with_read_conn(|conn| {
            conn.prepare(
                "SELECT kind, entity_id FROM identity_invalidation \
                 WHERE server_id = 's1' ORDER BY kind, entity_id",
            )?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect()
        })
        .expect("identity invalidations");
    assert_eq!(
        invalidated,
        vec![
            ("album".into(), "al-subtitle".into()),
            ("album".into(), "al-version".into()),
            ("track".into(), "subtitle".into()),
            ("track".into(), "version".into()),
        ]
    );
    assert_eq!(
        subsonic_server_names(&store),
        ("Song".to_string(), "Album".to_string())
    );

    store
        .with_conn_mut("test.reset_backfilled_title", |conn| {
            conn.execute("UPDATE track SET title = 'Song' WHERE id = 'subtitle'", [])
        })
        .expect("reset title");
    store
        .with_conn(
            "test.display_suffix_backfill_again",
            maybe_reconcile_native_display_suffix_backfill,
        )
        .expect("guarded display-suffix backfill");
    let title_after: String = store
        .with_read_conn(|conn| {
            conn.query_row("SELECT title FROM track WHERE id = 'subtitle'", [], |row| {
                row.get(0)
            })
        })
        .expect("title after guarded re-run");
    assert_eq!(title_after, "Song", "the completion marker stops the pass");
}

#[test]
fn native_display_suffix_backfill_defers_during_bulk_ingest_and_is_not_part_of_open() {
    let store = LibraryStore::open_in_memory();
    let marker_count: i64 = store
        .with_read_conn(|conn| {
            conn.query_row(
                "SELECT COUNT(*) FROM library_data_migration WHERE id = ?1",
                params![NATIVE_DISPLAY_SUFFIX_BACKFILL_RECONCILE_ID],
                |row| row.get(0),
            )
        })
        .expect("display-suffix marker count");
    assert_eq!(marker_count, 0);

    store.set_bulk_ingest_active(true);
    assert_eq!(
        store
            .run_native_display_suffix_backfill_batch()
            .unwrap()
            .step,
        LibraryBackfillStep::Deferred
    );
    store.set_bulk_ingest_active(false);
    assert_eq!(
        store
            .run_native_display_suffix_backfill_batch()
            .unwrap()
            .step,
        LibraryBackfillStep::Complete
    );
}

#[test]
fn native_display_suffix_backfill_caps_candidate_rows_per_tick_and_reports_changed_servers() {
    let store = LibraryStore::open_in_memory();
    store
        .with_conn_mut("test.seed_display_suffix_dense", |conn| {
            let tx = conn.transaction()?;
            mark_navidrome_native(&tx, "s1")?;
            for index in 0..600 {
                seed_track(
                    &tx,
                    &format!("track-{index}"),
                    "Song",
                    "Album",
                    0,
                    r#"{"updatedAt":"2026-01-01T00:00:00Z","tags":{"subtitle":["Live"]}}"#,
                )?;
            }
            seed_subsonic_server_track(
                &tx,
                r#"{"updatedAt":"2026-01-01T00:00:00Z","tags":{"subtitle":["Live"]}}"#,
            )?;
            tx.commit()
        })
        .expect("seed dense window");

    let suffixed = |store: &LibraryStore| -> i64 {
        store
            .with_read_conn(|conn| {
                conn.query_row(
                    "SELECT COUNT(*) FROM track WHERE title = 'Song (Live)'",
                    [],
                    |row| row.get(0),
                )
            })
            .expect("suffixed count")
    };

    let first = store.run_native_display_suffix_backfill_batch().unwrap();
    assert_eq!(first.step, LibraryBackfillStep::Pending);
    assert_eq!(first.changed_server_ids, vec!["s1".to_string()]);
    assert_eq!(suffixed(&store), 500, "one tick stops at the row cap");

    let second = store.run_native_display_suffix_backfill_batch().unwrap();
    assert_eq!(second.changed_server_ids, vec!["s1".to_string()]);
    assert_eq!(
        suffixed(&store),
        600,
        "the next tick resumes after the last row read"
    );

    let complete = store.run_native_display_suffix_backfill_batch().unwrap();
    assert_eq!(complete.step, LibraryBackfillStep::Complete);
    assert!(complete.changed_server_ids.is_empty());
    assert_eq!(subsonic_server_names(&store).0, "Song");
}

#[test]
fn native_display_suffix_backfill_walks_the_table_in_rowid_windows() {
    let store = LibraryStore::open_in_memory();
    store
        .with_conn_mut("test.seed_display_suffix_windows", |conn| {
            let tx = conn.transaction()?;
            mark_navidrome_native(&tx, "s1")?;
            for index in 0..10_001 {
                seed_track(&tx, &format!("track-{index}"), "Song", "Album", 0, "{}")?;
            }
            // The last row sits in the second window.
            tx.execute(
                "UPDATE track SET raw_json = ?1 WHERE id = 'track-10000'",
                [r#"{"updatedAt":"2026-01-01T00:00:00Z","tags":{"subtitle":["Live"]}}"#],
            )?;
            tx.commit()
        })
        .expect("seed windows");

    let cursor = |store: &LibraryStore| -> (i64, Option<i64>) {
        store
            .with_read_conn(|conn| {
                conn.query_row(
                    "SELECT cursor_rowid, completed_at FROM library_data_migration WHERE id = ?1",
                    params![NATIVE_DISPLAY_SUFFIX_BACKFILL_RECONCILE_ID],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
            })
            .expect("cursor")
    };

    assert_eq!(
        store
            .run_native_display_suffix_backfill_batch()
            .unwrap()
            .step,
        LibraryBackfillStep::Pending
    );
    assert_eq!(cursor(&store), (10_000, None));
    assert_eq!(
        store
            .run_native_display_suffix_backfill_batch()
            .unwrap()
            .step,
        LibraryBackfillStep::Pending
    );
    assert_eq!(
        store
            .run_native_display_suffix_backfill_batch()
            .unwrap()
            .step,
        LibraryBackfillStep::Complete
    );
    assert!(cursor(&store).1.is_some());
    let title: String = store
        .with_read_conn(|conn| {
            conn.query_row(
                "SELECT title FROM track WHERE id = 'track-10000'",
                [],
                |row| row.get(0),
            )
        })
        .expect("title in second window");
    assert_eq!(title, "Song (Live)");
}
