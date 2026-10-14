use super::*;
use crate::dto::{LibraryLabelAlbumsRequest, LibraryScopePair, LibrarySortClause, SortDir};
use crate::repos::{TrackRepository, TrackRow};

fn track(server: &str, id: &str, album_id: &str, library_id: &str, labels: &[&str]) -> TrackRow {
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
            "tags": { "recordlabel": labels },
        })
        .to_string(),
    }
}

fn request(label: &str) -> LibraryLabelAlbumsRequest {
    LibraryLabelAlbumsRequest {
        server_id: "s1".into(),
        label: label.into(),
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
fn list_albums_by_label_is_case_insensitive_and_deduplicates_album() {
    let store = LibraryStore::open_in_memory();

    TrackRepository::new(&store)
        .upsert_batch(&[
            track("s1", "t1", "al_a", "lib1", &["Warp", "Bleep"]),
            track("s1", "t2", "al_a", "lib1", &["Warp"]),
            track("s1", "t3", "al_b", "lib1", &["Ninja Tune"]),
        ])
        .unwrap();

    let response = list_albums_by_label(&store, &request("warp")).unwrap();

    assert_eq!(response.total, Some(1));
    assert_eq!(response.albums.len(), 1);
    assert_eq!(response.albums[0].id, "al_a");
}

#[test]
fn list_albums_by_label_respects_library_scope_and_total() {
    let store = LibraryStore::open_in_memory();

    TrackRepository::new(&store)
        .upsert_batch(&[
            track("s1", "t1", "al_a", "lib1", &["Warp"]),
            track("s1", "t2", "al_b", "lib1", &["Warp"]),
            track("s1", "t3", "al_c", "lib2", &["Warp"]),
        ])
        .unwrap();

    let mut scoped_request = request("Warp");
    scoped_request.library_scope = Some("lib1".into());

    let scoped = list_albums_by_label(&store, &scoped_request).unwrap();

    assert_eq!(scoped.total, Some(2));
    assert_eq!(scoped.albums.len(), 2);

    let all = list_albums_by_label(&store, &request("Warp")).unwrap();

    assert_eq!(all.total, Some(3));
    assert_eq!(all.albums.len(), 3);
}

#[test]
fn count_only_returns_total_without_album_rows() {
    let store = LibraryStore::open_in_memory();

    TrackRepository::new(&store)
        .upsert_batch(&[
            track("s1", "t1", "al_a", "lib1", &["Bleep"]),
            track("s1", "t2", "al_b", "lib1", &["Bleep"]),
        ])
        .unwrap();

    let mut req = request("Bleep");
    req.library_scope = Some("lib1".into());
    req.count_only = true;

    let response = list_albums_by_label(&store, &req).unwrap();

    assert_eq!(response.total, Some(2));
    assert!(response.albums.is_empty());
    assert!(!response.has_more);
}

#[test]
fn list_albums_by_label_paginates() {
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

    let first = list_albums_by_label(&store, &first_request).unwrap();

    assert_eq!(first.total, Some(3));
    assert_eq!(first.albums.len(), 1);
    assert_eq!(first.albums[0].id, "al_a");
    assert!(first.has_more);

    let mut second_request = first_request;
    second_request.offset = 1;

    let second = list_albums_by_label(&store, &second_request).unwrap();

    assert_eq!(second.total, Some(3));
    assert_eq!(second.albums.len(), 1);
    assert_eq!(second.albums[0].id, "al_b");
    assert!(second.has_more);
}

#[test]
fn scoped_label_query_drives_from_the_label_index() {
    let store = LibraryStore::open_in_memory();

    let scopes = vec![LibraryScopePair {
        server_id: "s1".into(),
        library_id: Some("lib1".into()),
    }];

    let (cte, binds) = scoped_label_album_cte(&scopes, "Warp");

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
            .any(|detail| { detail.contains("idx_track_label_browse",) }),
        "query plan must use the label-first browse index: {details:?}"
    );

    assert!(
        !details.iter().any(|detail| { detail == "SCAN t" }),
        "query plan must not drive from a full track scan: {details:?}"
    );
}

#[test]
fn list_albums_by_label_matches_a_raw_tag_value_with_invisible_marks() {
    let store = LibraryStore::open_in_memory();
    TrackRepository::new(&store)
        .upsert_batch(&[track("s1", "t1", "al_a", "lib1", &["Deram \u{200e}"])])
        .unwrap();
    let response = list_albums_by_label(&store, &request("Deram \u{200e}")).unwrap();
    assert_eq!(response.total, Some(1));
    assert_eq!(response.albums[0].id, "al_a");
}
