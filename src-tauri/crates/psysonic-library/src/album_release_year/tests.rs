use psysonic_integration::subsonic::AlbumSummary;
use rusqlite::params;
use serde_json::{json, Value};

use super::*;
use crate::browse_support::overlay_album_artist_links;
use crate::store::LibraryStore;

fn insert_track(store: &LibraryStore, track_id: &str, album_id: &str, year: i64, raw_json: &str) {
    store
        .with_conn_mut("test.album_release_year_seed", |conn| {
            conn.execute(
                "INSERT INTO artist (server_id, id, name, synced_at) \
                 VALUES ('s1', 'artist', 'Artist', 1) ON CONFLICT(server_id, id) DO NOTHING",
                [],
            )?;
            conn.execute(
                "INSERT INTO track (server_id, id, title, artist, artist_id, album, album_id, \
                 duration_sec, year, server_created_at, synced_at, raw_json) \
                 VALUES ('s1', ?1, ?1, 'Artist', 'artist', 'Album', ?2, 180, ?3, 1, 1, ?4)",
                params![track_id, album_id, year, raw_json],
            )?;
            Ok(())
        })
        .unwrap();
}

fn store_years(store: &LibraryStore, albums: &[AlbumReleaseYears]) -> usize {
    store
        .with_conn("test.album_release_year_store", |conn| {
            store_album_release_years(conn, "s1", albums)
        })
        .unwrap()
}

fn years(album_id: &str, original: Option<i64>, release: Option<i64>) -> AlbumReleaseYears {
    AlbumReleaseYears {
        album_id: album_id.into(),
        original_year: original,
        release_year: release,
    }
}

fn album(album_id: &str, raw_json: Value) -> LibraryAlbumDto {
    LibraryAlbumDto {
        server_id: "s1".into(),
        id: album_id.into(),
        name: "Album".into(),
        artist: Some("Artist".into()),
        artist_id: None,
        song_count: None,
        duration_sec: None,
        year: Some(1996),
        genre: None,
        cover_art_id: None,
        starred_at: None,
        synced_at: 1,
        raw_json,
    }
}

fn raw_years(album: &LibraryAlbumDto) -> (Option<i64>, Option<i64>) {
    (
        album.raw_json.get("originalYear").and_then(Value::as_i64),
        album.raw_json.get("releaseYear").and_then(Value::as_i64),
    )
}

#[test]
fn album_summary_reads_the_years_of_both_item_dates() {
    let summary: AlbumSummary = serde_json::from_value(json!({
        "id": "al1",
        "name": "Album",
        "year": 1996,
        "originalReleaseDate": { "year": 1996, "month": 4 },
        "releaseDate": { "year": 2026 },
    }))
    .unwrap();
    assert_eq!(summary.original_year, Some(1996));
    assert_eq!(summary.release_year, Some(2026));
}

#[test]
fn album_summary_treats_empty_or_malformed_dates_as_absent() {
    let summary: AlbumSummary = serde_json::from_value(json!({
        "id": "al1",
        "name": "Album",
        "originalReleaseDate": {},
        "releaseDate": "2026-01-01",
    }))
    .unwrap();
    assert_eq!(summary.original_year, None);
    assert_eq!(summary.release_year, None);

    let zero: AlbumSummary = serde_json::from_value(json!({
        "id": "al2",
        "name": "Album",
        "releaseDate": { "year": 0 },
    }))
    .unwrap();
    assert_eq!(zero.release_year, None);
}

#[test]
fn storing_an_unchanged_run_writes_nothing() {
    let store = LibraryStore::open_in_memory();
    let run = [
        years("al1", Some(1996), Some(2026)),
        years("al2", Some(1971), None),
    ];
    assert_eq!(store_years(&store, &run), 2);
    assert_eq!(store_years(&store, &run), 0);
    assert_eq!(
        store_years(&store, &[years("al1", Some(1996), Some(2027))]),
        1
    );
}

#[test]
fn an_album_the_server_stops_dating_loses_its_row() {
    let store = LibraryStore::open_in_memory();
    store_years(&store, &[years("al1", Some(1996), Some(2026))]);
    assert_eq!(store_years(&store, &[years("al1", None, Some(0))]), 1);
    let stored = store
        .with_read_conn(|conn| stored_album_release_years(conn, "s1", "al1"))
        .unwrap();
    assert_eq!(stored, None);
}

#[test]
fn native_track_years_win_over_the_census_table() {
    let store = LibraryStore::open_in_memory();
    insert_track(
        &store,
        "t1",
        "al1",
        1996,
        r#"{"libraryId":1,"originalYear":1996,"releaseYear":2026}"#,
    );
    store_years(&store, &[years("al1", Some(1995), Some(2025))]);
    let mut albums = vec![album("al1", Value::Null)];
    store
        .with_read_conn(|conn| {
            overlay_album_artist_links(conn, &mut albums);
            Ok(())
        })
        .unwrap();
    assert_eq!(raw_years(&albums[0]), (Some(1996), Some(2026)));
}

#[test]
fn subsonic_tracks_take_their_years_from_the_census_table() {
    let store = LibraryStore::open_in_memory();
    // A Subsonic song row: `year` only, which here holds the reissue's year.
    insert_track(
        &store,
        "t1",
        "al1",
        2005,
        r#"{"mediaType":"song","year":2005}"#,
    );
    store_years(&store, &[years("al1", Some(1971), Some(2005))]);
    let mut albums = vec![album("al1", json!({ "createdMs": 5 }))];
    store
        .with_read_conn(|conn| {
            overlay_album_artist_links(conn, &mut albums);
            Ok(())
        })
        .unwrap();
    assert_eq!(raw_years(&albums[0]), (Some(1971), Some(2005)));
    assert_eq!(albums[0].raw_json["createdMs"], 5);
    assert_eq!(
        albums[0].year,
        Some(1996),
        "the row's own year is left alone"
    );
}

#[test]
fn an_album_without_any_dated_source_keeps_its_payload_untouched() {
    let store = LibraryStore::open_in_memory();
    insert_track(&store, "t1", "al1", 1996, r#"{"mediaType":"song"}"#);
    let mut albums = vec![album("al1", Value::Null)];
    store
        .with_read_conn(|conn| {
            overlay_album_release_years(conn, &mut albums);
            Ok(())
        })
        .unwrap();
    assert_eq!(albums[0].raw_json, Value::Null);
}

#[test]
fn the_detail_overlay_reads_the_same_sources() {
    let store = LibraryStore::open_in_memory();
    insert_track(&store, "t1", "al1", 1996, r#"{"mediaType":"song"}"#);
    insert_track(
        &store,
        "t2",
        "al1",
        1996,
        r#"{"libraryId":1,"releaseYear":2026}"#,
    );
    store_years(&store, &[years("al1", Some(1996), Some(2020))]);
    let mut albums = vec![album("al1", json!({ "name": "Album" }))];
    store
        .with_read_conn(|conn| {
            overlay_album_release_years(conn, &mut albums);
            Ok(())
        })
        .unwrap();
    // Each year resolves on its own: the native release year, the census original.
    assert_eq!(raw_years(&albums[0]), (Some(1996), Some(2026)));
    assert_eq!(albums[0].raw_json["name"], "Album");
}

#[test]
fn a_payload_that_is_not_an_object_is_left_as_it_is() {
    let mut row = album("al1", json!(["unexpected"]));
    set_album_release_years(
        &mut row,
        ResolvedReleaseYears {
            original_year: Some(1996),
            release_year: None,
        },
    );
    assert_eq!(row.raw_json, json!(["unexpected"]));
}
