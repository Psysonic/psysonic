use super::*;
use crate::repos::{TrackRepository, TrackRow};

fn track(id: &str, album_id: &str, raw_json: Value) -> TrackRow {
    TrackRow {
        server_id: "s1".into(),
        id: id.into(),
        title: id.into(),
        title_sort: None,
        artist: Some("Primary".into()),
        artist_id: Some("primary".into()),
        album: "Album".into(),
        album_id: Some(album_id.into()),
        album_artist: Some("Primary".into()),
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
fn extracts_trimmed_track_and_album_credits() {
    let raw = serde_json::json!({
        "artists": [
            { "id": " primary ", "name": " Primary " },
            { "id": " guest ", "name": " Guest " },
            { "id": "", "name": "Missing" }
        ],
        "albumArtists": [
            { "id": " guest ", "name": " Guest " }
        ]
    });
    assert_eq!(
        extract_artist_credits(&raw.to_string()),
        vec![
            ArtistCredit {
                id: "guest".into(),
                name: "Guest".into(),
                key: "guest".into(),
                kind: "album",
            },
            ArtistCredit {
                id: "guest".into(),
                name: "Guest".into(),
                key: "guest".into(),
                kind: "track",
            },
            ArtistCredit {
                id: "primary".into(),
                name: "Primary".into(),
                key: "primary".into(),
                kind: "track",
            },
        ]
    );
}

#[test]
fn extracts_single_object_credit_from_subsonic_json() {
    let raw = serde_json::json!({
        "artists": { "id": "guest", "name": " Guest " }
    });
    assert_eq!(
        extract_artist_credits(&raw.to_string()),
        vec![ArtistCredit {
            id: "guest".into(),
            name: "Guest".into(),
            key: "guest".into(),
            kind: "track",
        }]
    );
}

#[test]
fn ingest_replaces_stale_credits_and_marks_primary() {
    let store = LibraryStore::open_in_memory();
    let repo = TrackRepository::new(&store);
    repo.upsert_batch(&[track(
        "t1",
        "a1",
        serde_json::json!({
            "artists": [
                { "id": "primary", "name": "Primary" },
                { "id": "guest", "name": " Guest " }
            ]
        }),
    )])
    .unwrap();

    let rows: Vec<(String, String, i64)> = store
        .with_conn("test", |conn| {
            let mut statement = conn.prepare(
                "SELECT artist_id, artist_name, is_primary FROM artist_credit_projection \
                 ORDER BY artist_id",
            )?;
            let rows = statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
                .collect();
            rows
        })
        .unwrap();
    assert_eq!(
        rows,
        vec![
            ("guest".into(), "Guest".into(), 0),
            ("primary".into(), "Primary".into(), 1),
        ]
    );

    repo.upsert_batch(&[track("t1", "a1", serde_json::json!({}))])
        .unwrap();
    let count: i64 = store
        .with_conn("test", |conn| {
            conn.query_row("SELECT COUNT(*) FROM artist_credit_projection", [], |row| {
                row.get(0)
            })
        })
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn backfill_is_idempotent_and_marks_completion() {
    let store = LibraryStore::open_in_memory();
    TrackRepository::new(&store)
        .upsert_batch(&[track(
            "t1",
            "a1",
            serde_json::json!({
                "artists": [{ "id": "guest", "name": "Guest" }]
            }),
        )])
        .unwrap();
    store
        .with_conn_mut("test", |conn| {
            conn.execute("DELETE FROM artist_credit_projection", [])?;
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
            conn.query_row("SELECT COUNT(*) FROM artist_credit_projection", [], |row| {
                row.get(0)
            })
        })
        .unwrap();
    assert_eq!(count, 1);
}
