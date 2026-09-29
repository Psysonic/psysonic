use super::*;
use crate::dto::{LibraryMoodAlbumsRequest, LibraryScopePair, LibrarySortClause, SortDir};
use crate::repos::{TrackRepository, TrackRow};

fn track(server: &str, id: &str, album_id: &str, library_id: &str, moods: &[&str]) -> TrackRow {
    TrackRow {
        server_id: server.into(),
        id: id.into(),
        title: format!("T{id}"),
        title_sort: None,
        artist: Some("Artist".into()),
        artist_id: Some("ar1".into()),
        album: album_id.into(),
        album_id: Some(album_id.into()),
        album_artist: None,
        duration_sec: 200,
        track_number: Some(1),
        disc_number: Some(1),
        year: Some(2000),
        genre: Some("Rock".into()),
        suffix: None,
        bit_rate: None,
        size_bytes: None,
        cover_art_id: None,
        starred_at: None,
        user_rating: None,
        play_count: None,
        played_at: None,
        server_path: None,
        library_id: Some(library_id.into()),
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
        raw_json: serde_json::json!({
            "moods": moods,
        })
        .to_string(),
    }
}

fn request(mood: &str) -> LibraryMoodAlbumsRequest {
    LibraryMoodAlbumsRequest {
        server_id: "s1".into(),
        mood: mood.into(),
        library_scope: None,
        library_scopes: None,
        sort: vec![LibrarySortClause {
            field: "name".into(),
            dir: SortDir::Asc,
        }],
        limit: 50,
        offset: 0,
        include_total: true,
        count_only: false,
    }
}

#[test]
fn list_albums_by_mood_is_case_insensitive_and_deduplicates_album() {
    let store = LibraryStore::open_in_memory();

    TrackRepository::new(&store)
        .upsert_batch(&[
            track("s1", "t1", "al_a", "lib1", &["Atmospheric", "Dreamy"]),
            track("s1", "t2", "al_a", "lib1", &["Atmospheric"]),
            track("s1", "t3", "al_b", "lib1", &["Nocturnal"]),
        ])
        .unwrap();

    let response = list_albums_by_mood(&store, &request("atmospheric")).unwrap();

    assert_eq!(response.total, Some(1));
    assert_eq!(response.albums.len(), 1);
    assert_eq!(response.albums[0].id, "al_a");
}

#[test]
fn list_albums_by_mood_respects_library_scope_and_total() {
    let store = LibraryStore::open_in_memory();

    TrackRepository::new(&store)
        .upsert_batch(&[
            track("s1", "t1", "al_a", "lib1", &["Atmospheric"]),
            track("s1", "t2", "al_b", "lib1", &["Atmospheric"]),
            track("s1", "t3", "al_c", "lib2", &["Atmospheric"]),
        ])
        .unwrap();

    let mut scoped_request = request("Atmospheric");
    scoped_request.library_scope = Some("lib1".into());

    let scoped = list_albums_by_mood(&store, &scoped_request).unwrap();

    assert_eq!(scoped.total, Some(2));
    assert_eq!(scoped.albums.len(), 2);

    let all = list_albums_by_mood(&store, &request("Atmospheric")).unwrap();

    assert_eq!(all.total, Some(3));
    assert_eq!(all.albums.len(), 3);
}

#[test]
fn count_only_returns_total_without_album_rows() {
    let store = LibraryStore::open_in_memory();

    TrackRepository::new(&store)
        .upsert_batch(&[
            track("s1", "t1", "al_a", "lib1", &["Dreamy"]),
            track("s1", "t2", "al_b", "lib1", &["Dreamy"]),
        ])
        .unwrap();

    let mut req = request("Dreamy");
    req.library_scope = Some("lib1".into());
    req.count_only = true;

    let response = list_albums_by_mood(&store, &req).unwrap();

    assert_eq!(response.total, Some(2));
    assert!(response.albums.is_empty());
    assert!(!response.has_more);
}

#[test]
fn list_albums_by_mood_paginates() {
    let store = LibraryStore::open_in_memory();

    TrackRepository::new(&store)
        .upsert_batch(&[
            track("s1", "t1", "al_a", "lib1", &["Energetic"]),
            track("s1", "t2", "al_b", "lib1", &["Energetic"]),
            track("s1", "t3", "al_c", "lib1", &["Energetic"]),
        ])
        .unwrap();

    let mut first_request = request("Energetic");
    first_request.limit = 1;

    let first = list_albums_by_mood(&store, &first_request).unwrap();

    assert_eq!(first.total, Some(3));
    assert_eq!(first.albums.len(), 1);
    assert_eq!(first.albums[0].id, "al_a");
    assert!(first.has_more);

    let mut second_request = first_request;
    second_request.offset = 1;

    let second = list_albums_by_mood(&store, &second_request).unwrap();

    assert_eq!(second.total, Some(3));
    assert_eq!(second.albums.len(), 1);
    assert_eq!(second.albums[0].id, "al_b");
    assert!(second.has_more);
}

#[test]
fn scoped_mood_query_drives_from_the_mood_index() {
    let store = LibraryStore::open_in_memory();

    let scopes = vec![LibraryScopePair {
        server_id: "s1".into(),
        library_id: Some("lib1".into()),
    }];

    let (cte, binds) = scoped_mood_album_cte(&scopes, "Atmospheric");

    let sql = format!(
        "EXPLAIN QUERY PLAN {cte} \
         SELECT COUNT(*) \
         FROM ranked \
         WHERE album_rank = 1"
    );

    let details = store
        .with_read_conn(|conn| {
            let mut stmt = conn.prepare(&sql)?;

            let rows = stmt.query_map(rusqlite::params_from_iter(binds.iter()), |row| {
                row.get::<_, String>(3)
            })?;

            rows.collect::<rusqlite::Result<Vec<_>>>()
        })
        .unwrap();

    assert!(
        details
            .iter()
            .any(|detail| { detail.contains("idx_track_mood_browse",) }),
        "query plan must use the mood-first browse index: {details:?}"
    );

    assert!(
        !details.iter().any(|detail| { detail == "SCAN t" }),
        "query plan must not drive from a full track scan: {details:?}"
    );
}
