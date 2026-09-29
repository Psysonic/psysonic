use super::*;
use crate::repos::{TrackRepository, TrackRow};

fn track(id: &str, album_id: &str, raw_json: Value) -> TrackRow {
    TrackRow {
        server_id: "s1".into(),
        id: id.into(),
        title: id.into(),
        title_sort: None,
        artist: Some("Performer".into()),
        artist_id: Some("performer".into()),
        album: "Album".into(),
        album_id: Some(album_id.into()),
        album_artist: Some("Performer".into()),
        duration_sec: 120,
        track_number: None,
        disc_number: None,
        year: None,
        genre: None,
        suffix: None,
        bit_rate: None,
        size_bytes: None,
        cover_art_id: None,
        starred_at: None,
        user_rating: None,
        play_count: None,
        played_at: None,
        server_path: None,
        library_id: Some("lib".into()),
        isrc: None,
        mbid_recording: None,
        bpm: None,
        replay_gain_track_db: None,
        replay_gain_album_db: None,
        replay_gain_peak: None,
        content_hash: None,
        server_updated_at: None,
        server_created_at: None,
        deleted: false,
        synced_at: 1,
        raw_json: raw_json.to_string(),
    }
}

#[test]
fn parses_nested_and_flat_composer_credits() {
    let raw = serde_json::json!({
        "contributors": [
            { "role": " Composer ", "artist": { "id": "c1", "name": "One" } },
            { "role": "COMPOSER", "artistId": "c2", "name": "Two" },
            { "role": "producer", "artistId": "p1", "name": "Producer" },
            { "role": "composer", "artistId": "", "name": "Missing" }
        ]
    });
    assert_eq!(
        extract_composer_credits(&raw.to_string()),
        vec![
            ComposerCredit {
                id: "c1".into(),
                name: "One".into()
            },
            ComposerCredit {
                id: "c2".into(),
                name: "Two".into()
            },
        ]
    );
}

#[test]
fn ingest_dedupes_album_credit_and_removes_stale_composer() {
    let store = LibraryStore::open_in_memory();
    let repo = TrackRepository::new(&store);
    let raw = serde_json::json!({
        "contributors": [{ "role": "composer", "artistId": "c1", "name": "Composer" }]
    });
    repo.upsert_batch(&[track("t1", "a1", raw.clone()), track("t2", "a1", raw)])
        .unwrap();
    let count: i64 = store
        .with_conn("test", |conn| {
            conn.query_row(
                "SELECT COUNT(*) FROM composer_album_projection",
                [],
                |row| row.get(0),
            )
        })
        .unwrap();
    assert_eq!(count, 1);

    repo.upsert_batch(&[track("t1", "a1", serde_json::json!({}))])
        .unwrap();
    repo.upsert_batch(&[track("t2", "a1", serde_json::json!({}))])
        .unwrap();
    let count: i64 = store
        .with_conn("test", |conn| {
            conn.query_row(
                "SELECT COUNT(*) FROM composer_album_projection",
                [],
                |row| row.get(0),
            )
        })
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn projection_follows_album_moves_and_tombstones() {
    let store = LibraryStore::open_in_memory();
    let repo = TrackRepository::new(&store);
    let raw = serde_json::json!({
        "contributors": [{ "role": "composer", "artistId": "c1", "name": "Composer" }]
    });
    let mut row = track("t1", "a1", raw);
    repo.upsert_batch(&[row.clone()]).unwrap();

    row.album_id = Some("a2".into());
    row.album = "Moved Album".into();
    row.library_id = Some("lib2".into());
    repo.upsert_batch(&[row]).unwrap();
    let owners: Vec<(String, String)> = store
        .with_conn("test", |conn| {
            let mut stmt = conn.prepare(
                "SELECT library_id, album_id FROM composer_album_projection ORDER BY library_id, album_id",
            )?;
            let mapped = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
            mapped.collect()
        })
        .unwrap();
    assert_eq!(owners, vec![("lib2".into(), "a2".into())]);

    repo.apply_tombstone_results("s1", "", &[], &["t1".into()])
        .unwrap();
    let count: i64 = store
        .with_conn("test", |conn| {
            conn.query_row(
                "SELECT COUNT(*) FROM composer_album_projection",
                [],
                |row| row.get(0),
            )
        })
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn backfill_is_idempotent_and_marks_completion() {
    let store = LibraryStore::open_in_memory();
    let raw = serde_json::json!({
        "contributors": [{ "role": "composer", "artistId": "c1", "name": "Composer" }]
    });
    TrackRepository::new(&store)
        .upsert_batch(&[track("t1", "a1", raw)])
        .unwrap();
    store
        .with_conn_mut("test", |conn| {
            conn.execute("DELETE FROM composer_album_projection", [])?;
            conn.execute(
                "DELETE FROM library_data_migration WHERE id = ?1",
                params![MIGRATION_ID],
            )?;
            Ok(())
        })
        .unwrap();

    assert!(inspect(&store).unwrap().needed);
    run_backfill(&store, None).unwrap();
    run_backfill(&store, None).unwrap();
    assert!(!inspect(&store).unwrap().needed);
    let count: i64 = store
        .with_conn("test", |conn| {
            conn.query_row(
                "SELECT COUNT(*) FROM composer_album_projection",
                [],
                |row| row.get(0),
            )
        })
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn partial_incremental_projection_does_not_imply_completion() {
    let store = LibraryStore::open_in_memory();
    let raw_one = serde_json::json!({
        "contributors": [{ "role": "composer", "artistId": "c1", "name": "One" }]
    });
    let raw_two = serde_json::json!({
        "contributors": [{ "role": "composer", "artistId": "c2", "name": "Two" }]
    });
    TrackRepository::new(&store)
        .upsert_batch(&[track("t1", "a1", raw_one), track("t2", "a2", raw_two)])
        .unwrap();
    store
        .with_conn_mut("test.partial_composer_projection", |conn| {
            conn.execute(
                "DELETE FROM composer_album_projection WHERE composer_id = 'c2'",
                [],
            )?;
            conn.execute(
                "DELETE FROM library_data_migration WHERE id = ?1",
                params![MIGRATION_ID],
            )?;
            Ok(())
        })
        .unwrap();

    let status = inspect(&store).unwrap();
    assert!(status.needed);
    assert_eq!(status.total_tracks, 2);
    assert_eq!(status.done_tracks, 0);

    run_backfill(&store, None).unwrap();
    assert!(!inspect(&store).unwrap().needed);
    let count: i64 = store
        .with_conn("test", |conn| {
            conn.query_row(
                "SELECT COUNT(*) FROM composer_album_projection",
                [],
                |row| row.get(0),
            )
        })
        .unwrap();
    assert_eq!(count, 2);
}
