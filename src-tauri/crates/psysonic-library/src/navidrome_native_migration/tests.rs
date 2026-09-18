use rusqlite::params;

use super::{
    finalize, has_rebuildable_state, preflight, reconcile_offline_paths, retarget_offline_paths,
    run_batch, upper_rowid, verify_offline_paths, NavidromeNativeMigrationStep,
};
use crate::navidrome_id_codec::canonical_id;
use crate::store::LibraryStore;

const LEGACY_TRACK: &str = "e3b7fc2ae9447bbec37a13bf916e3cf6";
const LEGACY_ARTIST: &str = "00112233445566778899aabbccddeeff";
const LEGACY_ALBUM: &str = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

fn fresh_dir(label: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!(
        "psysonic-native-migration-{label}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&path).unwrap();
    path
}

fn run_track_batches(store: &LibraryStore, limit: u32) -> (u32, u32) {
    let upper = upper_rowid(store, "s1", NavidromeNativeMigrationStep::Track).unwrap();
    let mut cursor = 0;
    let mut moved = 0;
    let mut merged = 0;
    while cursor < upper {
        let result = run_batch(
            store,
            "s1",
            NavidromeNativeMigrationStep::Track,
            cursor,
            upper,
            limit,
        )
        .unwrap();
        assert!(result.cursor_rowid > cursor);
        cursor = result.cursor_rowid;
        moved += result.moved;
        merged += result.merged;
    }
    (moved, merged)
}

#[test]
fn artist_batches_resume_against_the_original_upper_rowid() {
    let store = LibraryStore::open_in_memory();
    store
        .with_conn_mut("test.seed_native_artists", |conn| {
            conn.execute(
                "INSERT INTO artist \
                   (server_id, id, name, album_count, synced_at, raw_json) \
                 VALUES ('s1', ?1, 'Artist One', 1, 10, ?2)",
                params![
                    LEGACY_ARTIST,
                    serde_json::json!({ "id": LEGACY_ARTIST, "name": "Artist One" }).to_string()
                ],
            )?;
            conn.execute(
                "INSERT INTO artist \
                   (server_id, id, name, album_count, synced_at, raw_json) \
                 VALUES ('s1', ?1, 'Artist Two', 2, 20, ?2)",
                params![
                    LEGACY_ALBUM,
                    serde_json::json!({ "id": LEGACY_ALBUM, "name": "Artist Two" }).to_string()
                ],
            )?;
            Ok(())
        })
        .unwrap();

    let upper = upper_rowid(&store, "s1", NavidromeNativeMigrationStep::Artist).unwrap();
    let first = run_batch(
        &store,
        "s1",
        NavidromeNativeMigrationStep::Artist,
        0,
        upper,
        1,
    )
    .unwrap();
    assert!(!first.done);
    assert_eq!(first.processed, 1);

    let second = run_batch(
        &store,
        "s1",
        NavidromeNativeMigrationStep::Artist,
        first.cursor_rowid,
        upper,
        1,
    )
    .unwrap();
    assert!(second.done);
    assert_eq!(second.processed, 1);

    for old_id in [LEGACY_ARTIST, LEGACY_ALBUM] {
        let (old_exists, new_exists): (bool, bool) = store
            .with_read_conn(|conn| {
                conn.query_row(
                    "SELECT \
                       EXISTS(SELECT 1 FROM artist WHERE server_id = 's1' AND id = ?1), \
                       EXISTS(SELECT 1 FROM artist WHERE server_id = 's1' AND id = ?2)",
                    params![old_id, canonical_id(old_id)],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
            })
            .unwrap();
        assert!(!old_exists);
        assert!(new_exists);
    }
}

#[test]
fn track_collision_keeps_canonical_owner_and_retargets_history() {
    let store = LibraryStore::open_in_memory();
    let canonical_track = canonical_id(LEGACY_TRACK);
    store
        .with_conn_mut("test.seed_native_tracks", |conn| {
            conn.execute(
                "INSERT INTO track \
                   (server_id, id, title, album, starred_at, play_count, server_updated_at, \
                    deleted, synced_at, raw_json) \
                 VALUES ('s1', ?1, 'Legacy title', 'Album', 200, 9, 200, 0, 200, ?2)",
                params![
                    LEGACY_TRACK,
                    serde_json::json!({
                        "id": LEGACY_TRACK,
                        "albumId": LEGACY_ALBUM,
                        "artistId": LEGACY_ARTIST,
                        "suffix": "flac"
                    })
                    .to_string()
                ],
            )?;
            conn.execute(
                "INSERT INTO track \
                   (server_id, id, title, album, starred_at, play_count, server_updated_at, \
                    deleted, synced_at, raw_json) \
                 VALUES ('s1', ?1, 'Canonical title', 'Album', NULL, 2, 100, 0, 100, ?2)",
                params![
                    canonical_track,
                    serde_json::json!({ "id": canonical_track, "title": "Canonical title" })
                        .to_string()
                ],
            )?;
            conn.execute(
                "INSERT INTO play_session \
                   (server_id, track_id, started_at_ms, listened_sec, position_max_sec, \
                    completion, end_reason) \
                 VALUES ('s1', ?1, 1, 10, 10, 'full', 'ended')",
                params![LEGACY_TRACK],
            )?;
            conn.execute(
                "INSERT INTO entity_user_rating \
                   (server_id, entity_kind, entity_id, rating, fetched_at) \
                 VALUES ('s1', 'track', ?1, 4, 200), ('s1', 'track', ?2, 2, 100)",
                params![LEGACY_TRACK, canonical_track],
            )?;
            Ok(())
        })
        .unwrap();

    let upper = upper_rowid(&store, "s1", NavidromeNativeMigrationStep::Track).unwrap();
    let result = run_batch(
        &store,
        "s1",
        NavidromeNativeMigrationStep::Track,
        0,
        upper,
        20,
    )
    .unwrap();
    assert!(result.done);
    assert_eq!(result.merged, 1);

    let row: (String, Option<i64>, Option<i64>, i64, String, i64) = store
        .with_read_conn(|conn| {
            conn.query_row(
                "SELECT title, starred_at, play_count, deleted, raw_json, \
                        (SELECT rating FROM entity_user_rating \
                         WHERE server_id = 's1' AND entity_kind = 'track' AND entity_id = ?1) \
                 FROM track WHERE server_id = 's1' AND id = ?1",
                params![canonical_track],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
        })
        .unwrap();
    assert_eq!(row.0, "Canonical title");
    assert_eq!(row.1, Some(200));
    assert_eq!(row.2, Some(9));
    assert_eq!(row.3, 0);
    assert_eq!(row.5, 4);
    let payload: serde_json::Value = serde_json::from_str(&row.4).unwrap();
    assert_eq!(payload["id"], canonical_track);
    assert_eq!(payload["suffix"], "flac");

    let session_track: String = store
        .with_read_conn(|conn| {
            conn.query_row("SELECT track_id FROM play_session", [], |row| row.get(0))
        })
        .unwrap();
    assert_eq!(session_track, canonical_track);
}

#[test]
fn overflow_track_collision_accepts_a_moved_canonical_owner() {
    let store = LibraryStore::open_in_memory();
    let legacy_track = "K4CeqxxLfDLhWD8xzu9Pmh";
    let canonical_track = canonical_id(legacy_track);
    store
        .with_conn_mut("test.seed_moved_native_track", |conn| {
            conn.execute(
                "INSERT INTO track \
                   (server_id, id, title, album, duration_sec, size_bytes, server_path, \
                    deleted, synced_at, raw_json) \
                 VALUES ('s1', ?1, 'Promise Me', 'Promise Me (Acoustic)', 235, 9309018, \
                         'Badflower - Promise Me.mp3', 0, 1, ?2), \
                        ('s1', ?3, 'Promise Me', 'Promise Me (Acoustic)', 235, 9309018, \
                         'Badflower/Promise Me (Acoustic)/01-Promise Me.mp3', 0, 2, ?4)",
                params![
                    legacy_track,
                    serde_json::json!({ "id": legacy_track }).to_string(),
                    canonical_track,
                    serde_json::json!({ "id": canonical_track }).to_string(),
                ],
            )?;
            conn.execute(
                "INSERT INTO play_session \
                   (server_id, track_id, started_at_ms, listened_sec, position_max_sec, \
                    completion, end_reason) \
                 VALUES ('s1', ?1, 1, 10, 10, 'full', 'ended')",
                params![legacy_track],
            )?;
            Ok(())
        })
        .unwrap();

    preflight(&store, "s1").unwrap();
    let upper = upper_rowid(&store, "s1", NavidromeNativeMigrationStep::Track).unwrap();
    let result = run_batch(
        &store,
        "s1",
        NavidromeNativeMigrationStep::Track,
        0,
        upper,
        20,
    )
    .unwrap();
    assert_eq!(result.merged, 1);

    let (legacy_exists, canonical_exists, retargeted_sessions): (bool, bool, i64) = store
        .with_read_conn(|conn| {
            conn.query_row(
                "SELECT \
                   EXISTS(SELECT 1 FROM track WHERE server_id = 's1' AND id = ?1), \
                   EXISTS(SELECT 1 FROM track WHERE server_id = 's1' AND id = ?2), \
                   (SELECT COUNT(*) FROM play_session \
                    WHERE server_id = 's1' AND track_id = ?2)",
                params![legacy_track, canonical_track],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
        })
        .unwrap();
    assert!(!legacy_exists);
    assert!(canonical_exists);
    assert_eq!(retargeted_sessions, 1);
}

#[test]
fn overflow_track_collision_rejects_contradictory_strong_ids() {
    let store = LibraryStore::open_in_memory();
    let legacy_track = "K4CeqxxLfDLhWD8xzu9Pmh";
    let canonical_track = canonical_id(legacy_track);
    store
        .with_conn_mut("test.seed_contradictory_native_track", |conn| {
            conn.execute(
                "INSERT INTO track \
                   (server_id, id, title, album, duration_sec, size_bytes, content_hash, \
                    deleted, synced_at, raw_json) \
                 VALUES ('s1', ?1, 'Promise Me', 'Promise Me (Acoustic)', 235, 9309018, \
                         'hash-old', 0, 1, ?2), \
                        ('s1', ?3, 'Promise Me', 'Promise Me (Acoustic)', 235, 9309018, \
                         'hash-new', 0, 2, ?4)",
                params![
                    legacy_track,
                    serde_json::json!({ "id": legacy_track }).to_string(),
                    canonical_track,
                    serde_json::json!({ "id": canonical_track }).to_string(),
                ],
            )?;
            conn.execute(
                "INSERT INTO play_session \
                   (server_id, track_id, started_at_ms, listened_sec, position_max_sec, \
                    completion, end_reason) \
                 VALUES ('s1', ?1, 1, 10, 10, 'full', 'ended')",
                params![legacy_track],
            )?;
            Ok(())
        })
        .unwrap();

    assert!(preflight(&store, "s1")
        .unwrap_err()
        .contains("contradictory Navidrome track collision field `content_hash`"));
    let upper = upper_rowid(&store, "s1", NavidromeNativeMigrationStep::Track).unwrap();
    assert!(run_batch(
        &store,
        "s1",
        NavidromeNativeMigrationStep::Track,
        0,
        upper,
        20,
    )
    .unwrap_err()
    .contains("contradictory Navidrome track collision field `content_hash`"));

    let state: (i64, String) = store
        .with_read_conn(|conn| {
            conn.query_row(
                "SELECT COUNT(*), (SELECT track_id FROM play_session) FROM track",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
        })
        .unwrap();
    assert_eq!(state, (2, legacy_track.to_string()));
}

#[test]
fn overflow_track_collision_keeps_an_existing_alias_owner() {
    let store = LibraryStore::open_in_memory();
    let legacy_track = "uRfLiWcvOEOTfoq0CEjxmt";
    let computed_track = canonical_id(legacy_track);
    let existing_track = "7JIZs20Fig8REmBWDRmWZt";
    assert_ne!(computed_track, existing_track);
    store
        .with_conn_mut("test.seed_existing_track_alias", |conn| {
            conn.execute(
                "INSERT INTO track \
                   (server_id, id, title, album, server_path, deleted, synced_at, raw_json) \
                 VALUES ('s1', ?1, 'Gurenge', 'Gurenge', \
                         'Blinding Sunrise/Gurenge/01 - Gurenge.mp3', 0, 2, ?2), \
                        ('s1', ?3, 'Gurenge', 'Gurenge', \
                         'Blinding Sunrise - Gurenge.mp3', 0, 1, ?4), \
                        ('s1', ?5, 'Gurenge', 'Gurenge', \
                         'Blinding Sunrise - Gurenge.mp3', 0, 3, ?6)",
                params![
                    legacy_track,
                    serde_json::json!({ "id": legacy_track }).to_string(),
                    existing_track,
                    serde_json::json!({ "id": existing_track }).to_string(),
                    computed_track,
                    serde_json::json!({ "id": computed_track }).to_string(),
                ],
            )?;
            conn.execute(
                "INSERT INTO track_id_history \
                   (server_id, old_id, new_id, server_path, remapped_at) \
                 VALUES ('s1', ?1, ?2, 'Blinding Sunrise - Gurenge.mp3', 1)",
                params![legacy_track, existing_track],
            )?;
            conn.execute(
                "INSERT INTO play_session \
                   (server_id, track_id, started_at_ms, listened_sec, position_max_sec, \
                    completion, end_reason) \
                 VALUES ('s1', ?1, 1, 10, 10, 'full', 'ended')",
                params![legacy_track],
            )?;
            Ok(())
        })
        .unwrap();

    let (_, merged) = run_track_batches(&store, 1);
    assert_eq!(merged, 1);

    let state: (bool, bool, bool, String, String) = store
        .with_read_conn(|conn| {
            conn.query_row(
                "SELECT \
                   EXISTS(SELECT 1 FROM track WHERE server_id = 's1' AND id = ?1), \
                   EXISTS(SELECT 1 FROM track WHERE server_id = 's1' AND id = ?2), \
                   EXISTS(SELECT 1 FROM track WHERE server_id = 's1' AND id = ?3), \
                   (SELECT new_id FROM track_id_history \
                    WHERE server_id = 's1' AND old_id = ?1), \
                   (SELECT track_id FROM play_session WHERE server_id = 's1')",
                params![legacy_track, existing_track, computed_track],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
        })
        .unwrap();
    assert_eq!(
        state,
        (
            false,
            true,
            true,
            existing_track.to_string(),
            existing_track.to_string(),
        )
    );
}

#[test]
fn overflow_track_migration_collapses_a_stale_alias_cycle() {
    let store = LibraryStore::open_in_memory();
    let legacy_track = "XNMKOIuyafuxBspGhlKfWq";
    let stale_alias = "hAvxWe5AT4DBwzdmOdTiAd";
    let canonical_track = canonical_id(legacy_track);
    let filler_track = canonical_id("batch-boundary-filler");
    assert_eq!(canonical_track, "5whr2E9RjWewxrq0CNMaJC");
    store
        .with_conn_mut("test.seed_stale_track_alias_cycle", |conn| {
            conn.execute(
                "INSERT INTO track \
                   (server_id, id, title, album, server_path, deleted, synced_at, raw_json) \
                 VALUES ('s1', ?1, 'Filler', 'Filler', NULL, 0, 1, ?2), \
                        ('s1', ?3, 'Birth of the Blues', 'Chet Lag', \
                         'Tommy Emmanuel/Chet Lag/01-08 - Birth of the Blues.mp3', 0, 2, ?4)",
                params![
                    filler_track,
                    serde_json::json!({ "id": filler_track }).to_string(),
                    legacy_track,
                    serde_json::json!({ "id": legacy_track }).to_string(),
                ],
            )?;
            conn.execute(
                "INSERT INTO track_id_history \
                   (server_id, old_id, new_id, server_path, remapped_at) \
                 VALUES ('s1', ?1, ?2, 'Tommy Emmanuel/Chet Lag/01-08 - Birth of the Blues.mp3', 1), \
                        ('s1', ?2, ?1, 'Tommy Emmanuel/Chet Lag/01-08 - Birth of the Blues.mp3', 2)",
                params![legacy_track, stale_alias],
            )?;
            conn.execute(
                "INSERT INTO play_session \
                   (server_id, track_id, started_at_ms, listened_sec, position_max_sec, \
                    completion, end_reason) \
                 VALUES ('s1', ?1, 1, 10, 10, 'full', 'ended')",
                params![legacy_track],
            )?;
            Ok(())
        })
        .unwrap();

    let (moved, _) = run_track_batches(&store, 1);
    assert_eq!(moved, 1);

    let state: (bool, bool, i64, i64) = store
        .with_read_conn(|conn| {
            conn.query_row(
                "SELECT \
                   EXISTS(SELECT 1 FROM track WHERE server_id = 's1' AND id = ?1), \
                   EXISTS(SELECT 1 FROM track WHERE server_id = 's1' AND id = ?2), \
                   (SELECT COUNT(*) FROM track_id_history \
                    WHERE server_id = 's1' AND old_id IN (?1, ?3) AND new_id = ?2), \
                   (SELECT COUNT(*) FROM play_session \
                    WHERE server_id = 's1' AND track_id = ?2)",
                params![legacy_track, canonical_track, stale_alias],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
        })
        .unwrap();
    assert_eq!(state, (false, true, 2, 1));
}

#[test]
fn overflow_track_migration_ignores_a_deleted_alias_owner() {
    let store = LibraryStore::open_in_memory();
    let legacy_track = "XNMKOIuyafuxBspGhlKfWq";
    let deleted_alias = "hAvxWe5AT4DBwzdmOdTiAd";
    let canonical_track = canonical_id(legacy_track);
    let deleted_alias_destination = canonical_id(deleted_alias);
    store
        .with_conn_mut("test.seed_deleted_track_alias_owner", |conn| {
            conn.execute(
                "INSERT INTO track \
                   (server_id, id, title, album, deleted, synced_at, raw_json) \
                 VALUES ('s1', ?1, 'Birth of the Blues', 'Chet Lag', 0, 2, ?2), \
                        ('s1', ?3, 'Old tombstone', 'Old album', 1, 1, ?4)",
                params![
                    legacy_track,
                    serde_json::json!({ "id": legacy_track }).to_string(),
                    deleted_alias,
                    serde_json::json!({ "id": deleted_alias }).to_string(),
                ],
            )?;
            conn.execute(
                "INSERT INTO track_id_history (server_id, old_id, new_id, remapped_at) \
                 VALUES ('s1', ?1, ?2, 1)",
                params![legacy_track, deleted_alias],
            )?;
            conn.execute(
                "INSERT INTO play_session \
                   (server_id, track_id, started_at_ms, listened_sec, position_max_sec, \
                    completion, end_reason) \
                 VALUES ('s1', ?1, 1, 10, 10, 'full', 'ended')",
                params![legacy_track],
            )?;
            Ok(())
        })
        .unwrap();

    let (moved, merged) = run_track_batches(&store, 1);
    assert_eq!((moved, merged), (2, 0));
    let state: (bool, bool, String, String) = store
        .with_read_conn(|conn| {
            conn.query_row(
                "SELECT \
                   EXISTS(SELECT 1 FROM track WHERE server_id = 's1' AND id = ?1 AND deleted = 0), \
                   EXISTS(SELECT 1 FROM track WHERE server_id = 's1' AND id = ?2 AND deleted = 1), \
                   (SELECT new_id FROM track_id_history WHERE server_id = 's1' AND old_id = ?3), \
                   (SELECT track_id FROM play_session)",
                params![canonical_track, deleted_alias_destination, legacy_track],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
        })
        .unwrap();
    assert_eq!(
        state,
        (
            true,
            true,
            canonical_track.to_string(),
            canonical_track.to_string(),
        )
    );
}

#[test]
fn overflow_track_migration_replaces_a_deleted_canonical_owner() {
    let store = LibraryStore::open_in_memory();
    let legacy_track = "XNMKOIuyafuxBspGhlKfWq";
    let canonical_track = canonical_id(legacy_track);
    store
        .with_conn_mut("test.seed_deleted_canonical_track_owner", |conn| {
            conn.execute(
                "INSERT INTO track \
                   (server_id, id, title, title_sort, album, duration_sec, size_bytes, play_count, \
                    played_at, library_id, content_hash, server_updated_at, server_created_at, \
                    deleted, synced_at, raw_json) \
                 VALUES ('s1', ?1, 'Birth of the Blues', NULL, 'Chet Lag', 351, 14168871, \
                         NULL, NULL, NULL, NULL, NULL, NULL, 0, 2, ?2), \
                        ('s1', ?3, 'Old tombstone', 'Stale sort', 'Old album', 0, 1, 99, \
                         98, 'stale-library', 'stale-hash', 97, 96, 1, 1, ?4)",
                params![
                    legacy_track,
                    serde_json::json!({ "id": legacy_track }).to_string(),
                    canonical_track,
                    serde_json::json!({ "id": canonical_track, "staleOnly": true }).to_string(),
                ],
            )?;
            conn.execute(
                "INSERT INTO track_id_history (server_id, old_id, new_id, remapped_at) \
                 VALUES ('s1', ?1, ?2, 1)",
                params![legacy_track, canonical_track],
            )?;
            conn.execute(
                "INSERT INTO play_session \
                   (server_id, track_id, started_at_ms, listened_sec, position_max_sec, \
                    completion, end_reason) \
                 VALUES ('s1', ?1, 1, 10, 10, 'full', 'ended')",
                params![legacy_track],
            )?;
            conn.execute(
                "INSERT INTO play_session \
                   (server_id, track_id, started_at_ms, listened_sec, position_max_sec, \
                    completion, end_reason) \
                 VALUES ('s1', ?1, 2, 20, 20, 'full', 'ended')",
                params![canonical_track],
            )?;
            Ok(())
        })
        .unwrap();

    let (moved, merged) = run_track_batches(&store, 20);
    assert_eq!((moved, merged), (1, 0));
    let state: (i64, String, bool, String, String, i64) = store
        .with_read_conn(|conn| {
            conn.query_row(
                "SELECT \
                   (SELECT COUNT(*) FROM track WHERE server_id = 's1'), \
                   title, \
                   title_sort IS NULL AND play_count IS NULL AND played_at IS NULL \
                     AND library_id IS NULL AND content_hash IS NULL \
                     AND server_updated_at IS NULL AND server_created_at IS NULL, \
                   raw_json, \
                   (SELECT new_id FROM track_id_history WHERE server_id = 's1' AND old_id = ?2), \
                   (SELECT COUNT(*) FROM play_session \
                    WHERE server_id = 's1' AND track_id = ?1) \
                 FROM track WHERE server_id = 's1' AND id = ?1 AND deleted = 0",
                params![canonical_track, legacy_track],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
        })
        .unwrap();
    let payload: serde_json::Value = serde_json::from_str(&state.3).unwrap();
    assert_eq!(payload["id"], state.4);
    assert_eq!(payload["staleOnly"], serde_json::Value::Null);
    assert_eq!(
        (state.0, state.1, state.2, state.4, state.5),
        (
            1,
            "Birth of the Blues".to_string(),
            true,
            canonical_track.clone(),
            2,
        )
    );
}

#[test]
fn stale_alias_cleanup_rolls_back_when_child_retarget_conflicts() {
    let store = LibraryStore::open_in_memory();
    let legacy_track = "XNMKOIuyafuxBspGhlKfWq";
    let stale_alias = "hAvxWe5AT4DBwzdmOdTiAd";
    let canonical_track = canonical_id(legacy_track);
    store
        .with_conn_mut("test.seed_stale_alias_rollback", |conn| {
            conn.execute(
                "INSERT INTO track \
                   (server_id, id, title, album, duration_sec, size_bytes, deleted, synced_at, raw_json) \
                 VALUES ('s1', ?1, 'Birth of the Blues', 'Chet Lag', 351, 14168871, 0, 2, ?2), \
                        ('s1', ?3, 'Birth of the Blues', 'Chet Lag', 351, 14168871, 0, 1, ?4)",
                params![
                    legacy_track,
                    serde_json::json!({ "id": legacy_track }).to_string(),
                    canonical_track,
                    serde_json::json!({ "id": canonical_track }).to_string(),
                ],
            )?;
            conn.execute(
                "INSERT INTO track_id_history (server_id, old_id, new_id, remapped_at) \
                 VALUES ('s1', ?1, ?2, 1)",
                params![legacy_track, stale_alias],
            )?;
            conn.execute_batch(
                "INSERT INTO canonical_track(id, created_at, updated_at) VALUES \
                   ('canonical-1', 1, 1), ('canonical-2', 1, 1); \
                 INSERT INTO track_canonical_link \
                   (server_id, track_id, canonical_id, match_method, confidence, linked_at) \
                 VALUES ('s1', 'XNMKOIuyafuxBspGhlKfWq', 'canonical-1', 'path', 0.8, 1), \
                        ('s1', '5whr2E9RjWewxrq0CNMaJC', 'canonical-2', 'isrc', 0.9, 1);",
            )?;
            Ok(())
        })
        .unwrap();

    let upper = upper_rowid(&store, "s1", NavidromeNativeMigrationStep::Track).unwrap();
    assert!(run_batch(
        &store,
        "s1",
        NavidromeNativeMigrationStep::Track,
        0,
        upper,
        20,
    )
    .unwrap_err()
    .contains("canonical track link conflict"));

    let state: (i64, String, i64) = store
        .with_read_conn(|conn| {
            conn.query_row(
                "SELECT \
                   (SELECT COUNT(*) FROM track WHERE server_id = 's1' AND id IN (?1, ?2)), \
                   (SELECT new_id FROM track_id_history WHERE server_id = 's1' AND old_id = ?1), \
                   (SELECT COUNT(*) FROM track_canonical_link WHERE server_id = 's1')",
                params![legacy_track, canonical_track],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
        })
        .unwrap();
    assert_eq!(state, (2, stale_alias.to_string(), 2));
}

#[test]
fn track_without_preserved_references_uses_alias_history_and_drops_genres() {
    let store = LibraryStore::open_in_memory();
    let canonical_track = canonical_id(LEGACY_TRACK);
    store
        .with_conn_mut("test.seed_simple_native_track", |conn| {
            conn.execute(
                "INSERT INTO track \
                   (server_id, id, title, album, deleted, synced_at, raw_json) \
                 VALUES ('s1', ?1, 'Legacy title', 'Album', 0, 10, ?2)",
                params![
                    LEGACY_TRACK,
                    serde_json::json!({ "id": LEGACY_TRACK, "genre": "Rock" }).to_string()
                ],
            )?;
            conn.execute(
                "INSERT INTO track_genre (server_id, track_id, genre) \
                 VALUES ('s1', ?1, 'Rock')",
                params![LEGACY_TRACK],
            )?;
            Ok(())
        })
        .unwrap();

    let upper = upper_rowid(&store, "s1", NavidromeNativeMigrationStep::Track).unwrap();
    let result = run_batch(
        &store,
        "s1",
        NavidromeNativeMigrationStep::Track,
        0,
        upper,
        20,
    )
    .unwrap();
    assert!(result.done);
    assert_eq!(result.moved, 1);

    let state: (bool, bool, String, i64, i64) = store
        .with_read_conn(|conn| {
            conn.query_row(
                "SELECT \
                   EXISTS(SELECT 1 FROM track WHERE server_id = 's1' AND id = ?1), \
                   EXISTS(SELECT 1 FROM track WHERE server_id = 's1' AND id = ?2), \
                   (SELECT new_id FROM track_id_history \
                    WHERE server_id = 's1' AND old_id = ?1), \
                   (SELECT COUNT(*) FROM track_genre WHERE server_id = 's1'), \
                   (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' \
                    AND name IN ('track_ai', 'track_ad', 'track_au'))",
                params![LEGACY_TRACK, canonical_track],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
        })
        .unwrap();
    assert_eq!(state, (false, true, canonical_track, 0, 3));
}

#[test]
fn album_collision_retargets_tracks_and_preserves_newer_user_state() {
    let store = LibraryStore::open_in_memory();
    let canonical_album = canonical_id(LEGACY_ALBUM);
    store
        .with_conn_mut("test.seed_native_albums", |conn| {
            conn.execute(
                "INSERT INTO album \
                   (server_id, id, name, artist_id, starred_at, synced_at, raw_json) \
                 VALUES ('s1', ?1, 'Legacy album', ?2, 200, 200, ?3)",
                params![
                    LEGACY_ALBUM,
                    LEGACY_ARTIST,
                    serde_json::json!({
                        "id": LEGACY_ALBUM,
                        "artistId": LEGACY_ARTIST,
                        "genre": "Rock"
                    })
                    .to_string()
                ],
            )?;
            conn.execute(
                "INSERT INTO album \
                   (server_id, id, name, starred_at, synced_at, raw_json) \
                 VALUES ('s1', ?1, 'Canonical album', NULL, 100, ?2)",
                params![
                    canonical_album,
                    serde_json::json!({ "id": canonical_album, "name": "Canonical album" })
                        .to_string()
                ],
            )?;
            conn.execute(
                "INSERT INTO track (server_id, id, title, album, album_id, synced_at, raw_json) \
                 VALUES ('s1', 'track-1', 'Track', 'Album', ?1, 1, '{}')",
                params![LEGACY_ALBUM],
            )?;
            conn.execute(
                "INSERT INTO entity_user_rating \
                   (server_id, entity_kind, entity_id, rating, fetched_at) \
                 VALUES ('s1', 'album', ?1, 5, 200)",
                params![LEGACY_ALBUM],
            )?;
            Ok(())
        })
        .unwrap();

    let upper = upper_rowid(&store, "s1", NavidromeNativeMigrationStep::Album).unwrap();
    run_batch(
        &store,
        "s1",
        NavidromeNativeMigrationStep::Album,
        0,
        upper,
        20,
    )
    .unwrap();

    let row: (String, Option<String>, Option<i64>, String, i64) = store
        .with_read_conn(|conn| {
            conn.query_row(
                "SELECT name, artist_id, starred_at, raw_json, \
                        (SELECT rating FROM entity_user_rating \
                         WHERE server_id = 's1' AND entity_kind = 'album' AND entity_id = ?1) \
                 FROM album WHERE server_id = 's1' AND id = ?1",
                params![canonical_album],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
        })
        .unwrap();
    assert_eq!(row.0, "Canonical album");
    assert_eq!(row.1, Some(canonical_id(LEGACY_ARTIST)));
    assert_eq!(row.2, Some(200));
    assert_eq!(row.4, 5);
    let payload: serde_json::Value = serde_json::from_str(&row.3).unwrap();
    assert_eq!(payload["id"], canonical_album);
    assert_eq!(payload["genre"], "Rock");

    let track_album: String = store
        .with_read_conn(|conn| {
            conn.query_row(
                "SELECT album_id FROM track WHERE id = 'track-1'",
                [],
                |row| row.get(0),
            )
        })
        .unwrap();
    assert_eq!(track_album, canonical_album);
}

#[test]
fn unproven_overflow_collision_rolls_back_the_batch() {
    let store = LibraryStore::open_in_memory();
    let legacy = "zzzzzzzzzzzzzzzzzzzzzz";
    let canonical = canonical_id(legacy);
    store
        .with_conn_mut("test.seed_native_collision", |conn| {
            conn.execute(
                "INSERT INTO artist (server_id, id, name, synced_at, raw_json) \
                 VALUES ('s1', ?1, 'Legacy', 2, '{}'), ('s1', ?2, 'Other', 1, '{}')",
                params![legacy, canonical],
            )?;
            Ok(())
        })
        .unwrap();

    let preflight_error = preflight(&store, "s1").unwrap_err();
    assert!(preflight_error.contains("unproven Navidrome artist collision"));

    let upper = upper_rowid(&store, "s1", NavidromeNativeMigrationStep::Artist).unwrap();
    let error = run_batch(
        &store,
        "s1",
        NavidromeNativeMigrationStep::Artist,
        0,
        upper,
        20,
    )
    .unwrap_err();
    assert!(error.contains("unproven Navidrome artist collision"));

    let count: i64 = store
        .with_read_conn(|conn| {
            conn.query_row(
                "SELECT COUNT(*) FROM artist WHERE server_id = 's1' AND id IN (?1, ?2)",
                params![legacy, canonical],
                |row| row.get(0),
            )
        })
        .unwrap();
    assert_eq!(count, 2);
}

#[test]
fn finalization_clears_rebuildable_state_and_rebuilds_fts() {
    let store = LibraryStore::open_in_memory();
    let canonical_track = canonical_id(LEGACY_TRACK);
    store
        .with_conn_mut("test.seed_native_finalize", |conn| {
            conn.execute(
                "INSERT INTO track (server_id, id, title, album, synced_at, raw_json) \
                 VALUES ('s1', ?1, 'Canonical Song', 'Album', 1, ?2)",
                params![
                    canonical_track,
                    serde_json::json!({ "id": canonical_track, "title": "Canonical Song" })
                        .to_string()
                ],
            )?;
            conn.execute(
                "INSERT INTO track_genre (server_id, track_id, genre) \
                 VALUES ('s1', ?1, 'Rock')",
                params![canonical_track],
            )?;
            conn.execute(
                "INSERT INTO sync_state (server_id, library_scope) VALUES ('s1', '')",
                [],
            )?;
            conn.execute(
                "INSERT INTO cluster.track_cluster_key \
                   (server_id, library_id, track_id, cluster_key, occurrence_rank) \
                 VALUES ('s1', '', ?1, 'stale', 0)",
                params![canonical_track],
            )?;
            Ok(())
        })
        .unwrap();

    let result = finalize(&store, "s1").unwrap();
    assert_eq!(result.derived_rows_removed, 3);

    let state: (i64, i64, i64, i64, i64) = store
        .with_read_conn(|conn| {
            conn.query_row(
                "SELECT \
                   (SELECT COUNT(*) FROM track_genre WHERE server_id = 's1'), \
                   (SELECT COUNT(*) FROM sync_state WHERE server_id = 's1'), \
                   (SELECT COUNT(*) FROM cluster.track_cluster_key WHERE server_id = 's1'), \
                   (SELECT COUNT(*) FROM identity_invalidation \
                      WHERE server_id = 's1' AND kind = 'server'), \
                   (SELECT COUNT(*) FROM track_fts WHERE track_fts MATCH 'Canonical')",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
        })
        .unwrap();
    assert_eq!(state, (0, 0, 0, 1, 1));
}

#[test]
fn rebuildable_state_distinguishes_a_pristine_server() {
    let store = LibraryStore::open_in_memory();
    assert!(!has_rebuildable_state(&store, "s1").unwrap());

    store
        .with_conn_mut("test.seed_rebuildable_state", |conn| {
            conn.execute(
                "INSERT INTO sync_state (server_id, library_scope) VALUES ('s1', '')",
                [],
            )?;
            Ok(())
        })
        .unwrap();

    assert!(has_rebuildable_state(&store, "s1").unwrap());
    assert!(!has_rebuildable_state(&store, "s2").unwrap());
}

#[test]
fn rebuildable_state_allows_a_missing_cluster_sidecar() {
    let store = LibraryStore::open_in_memory();
    store
        .with_read_conn(|conn| conn.execute_batch("DETACH DATABASE cluster"))
        .unwrap();

    assert!(!has_rebuildable_state(&store, "s1").unwrap());
}

#[test]
fn finalization_rolls_back_cleanup_when_legacy_residue_remains() {
    let store = LibraryStore::open_in_memory();
    store
        .with_conn_mut("test.seed_native_finalize_residue", |conn| {
            conn.execute(
                "INSERT INTO artist (server_id, id, name, synced_at, raw_json) \
                 VALUES ('s1', ?1, 'Legacy', 1, ?2)",
                params![
                    LEGACY_ARTIST,
                    serde_json::json!({ "id": LEGACY_ARTIST }).to_string()
                ],
            )?;
            conn.execute(
                "INSERT INTO sync_state (server_id, library_scope) VALUES ('s1', '')",
                [],
            )?;
            Ok(())
        })
        .unwrap();

    let error = finalize(&store, "s1").unwrap_err();
    assert!(error.contains("native migration residue in artist.id"));

    let state: (i64, i64) = store
        .with_read_conn(|conn| {
            conn.query_row(
                "SELECT \
                   (SELECT COUNT(*) FROM sync_state WHERE server_id = 's1'), \
                   (SELECT COUNT(*) FROM identity_invalidation WHERE server_id = 's1')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
        })
        .unwrap();
    assert_eq!(state, (1, 0));
}

#[test]
fn retargets_offline_paths_without_opening_a_second_database_connection() {
    let store = LibraryStore::open_in_memory();
    store
        .with_conn_mut("test.seed_offline_path_retarget", |conn| {
            conn.execute(
                "INSERT INTO track_offline \
                   (server_id, track_id, local_path, cached_at) \
                 VALUES ('s1', 'canonical-track', '/old/track.flac', 1)",
                [],
            )?;
            Ok(())
        })
        .unwrap();

    let updated = retarget_offline_paths(
        &store,
        "s1",
        &[("/old/track.flac".to_string(), "/new/track.flac".to_string())],
    )
    .unwrap();
    assert_eq!(updated, 1);
    let path: String = store
        .with_read_conn(|conn| {
            conn.query_row(
                "SELECT local_path FROM track_offline WHERE server_id = 's1'",
                [],
                |row| row.get(0),
            )
        })
        .unwrap();
    assert_eq!(path, "/new/track.flac");
}

#[test]
fn retry_repairs_offline_db_path_after_file_was_already_renamed() {
    let dir = fresh_dir("resume-after-rename");
    let source = dir.join(format!("{LEGACY_TRACK}.flac"));
    let destination = dir.join(format!("{}.flac", canonical_id(LEGACY_TRACK)));
    std::fs::write(&source, b"audio").unwrap();
    std::fs::rename(&source, &destination).unwrap();

    let store = LibraryStore::open_in_memory();
    store
        .with_conn_mut("test.seed_stale_offline_path", |conn| {
            conn.execute(
                "INSERT INTO track_offline (server_id, track_id, local_path, cached_at) \
                 VALUES ('s1', 'canonical-track', ?1, 1)",
                params![source.to_string_lossy().as_ref()],
            )?;
            Ok(())
        })
        .unwrap();

    let verification_error = verify_offline_paths(&store, "s1", &dir).unwrap_err();
    assert!(verification_error.contains("track_offline.local_path"));

    let retargeted = reconcile_offline_paths(&store, "s1", &dir, &[]).unwrap();
    assert_eq!(retargeted, 1);
    let local_path: String = store
        .with_read_conn(|conn| {
            conn.query_row(
                "SELECT local_path FROM track_offline WHERE server_id = 's1'",
                [],
                |row| row.get(0),
            )
        })
        .unwrap();
    assert_eq!(std::path::PathBuf::from(local_path), destination);
    verify_offline_paths(&store, "s1", &dir).unwrap();
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn retry_keeps_stale_db_path_when_canonical_destination_is_missing() {
    let dir = fresh_dir("missing-destination");
    let source = dir.join(format!("{LEGACY_TRACK}.flac"));
    let store = LibraryStore::open_in_memory();
    store
        .with_conn_mut("test.seed_missing_offline_path", |conn| {
            conn.execute(
                "INSERT INTO track_offline (server_id, track_id, local_path, cached_at) \
                 VALUES ('s1', 'canonical-track', ?1, 1)",
                params![source.to_string_lossy().as_ref()],
            )?;
            Ok(())
        })
        .unwrap();

    assert_eq!(reconcile_offline_paths(&store, "s1", &dir, &[]).unwrap(), 0);
    assert!(verify_offline_paths(&store, "s1", &dir)
        .unwrap_err()
        .contains("track_offline.local_path"));
    let _ = std::fs::remove_dir_all(dir);
}
