use rusqlite::types::Value as SqlValue;

use super::support::{req, scope_pair, scoped_track, track};
use crate::advanced_search::filters::WhereBuilder;
use crate::advanced_search::run_advanced_search;
use crate::advanced_search::sql::{
    is_fast_random_track_sample, query_random_track_rows_with, random_rowid_pivot,
};
use crate::dto::{LibraryScopePair, LibrarySortClause, SortDir};
use crate::filter::EntityKind;
use crate::repos::TrackRepository;
use crate::store::LibraryStore;

#[test]
fn unfiltered_random_track_request_uses_bounded_sample_path() {
    let store = LibraryStore::open_in_memory();
    let tracks = (0..12)
        .map(|index| {
            track(
                "s1",
                &format!("t-{index:02}"),
                &format!("Song {index}"),
                "Artist",
                "Album",
            )
        })
        .collect::<Vec<_>>();
    TrackRepository::new(&store).upsert_batch(&tracks).unwrap();

    let mut r = req("s1", &[EntityKind::Track]);
    r.sort = vec![LibrarySortClause {
        field: "random".into(),
        dir: SortDir::Asc,
    }];
    r.limit = 4;
    r.skip_totals = true;
    r.library_scopes = Some(vec![LibraryScopePair {
        server_id: "s1".into(),
        library_id: None,
    }]);

    assert!(is_fast_random_track_sample(&r, None, &[], 0));
    let response = run_advanced_search(&store, &r).unwrap();
    assert_eq!(response.tracks.len(), 4);
    assert_eq!(response.totals.tracks, 0);

    r.offset = 1;
    assert!(!is_fast_random_track_sample(&r, None, &[], 1));
}

#[test]
fn random_rowid_pivot_stays_inside_bounds() {
    assert_eq!(random_rowid_pivot(7, 7), 7);
    assert!((10..=25).contains(&random_rowid_pivot(10, 25)));
}

/// Seed three albums the way ingest writes a catalog: one after another, so a
/// run of rowids is one album in track order.
fn seed_three_albums(store: &LibraryStore) {
    let mut tracks = Vec::new();
    for album in 0..3 {
        for index in 0..10 {
            tracks.push(track(
                "s1",
                &format!("t-{album}-{index:02}"),
                &format!("Song {index}"),
                "Artist",
                &format!("Album {album}"),
            ));
        }
    }
    TrackRepository::new(store).upsert_batch(&tracks).unwrap();
}

fn scoped_where() -> WhereBuilder {
    let mut w = WhereBuilder::new();
    w.push_param("t.server_id = ?", SqlValue::Text("s1".into()));
    w.push_raw("t.deleted = 0");
    w
}

#[test]
fn random_sample_draws_one_pivot_per_row_rather_than_a_run() {
    let store = LibraryStore::open_in_memory();
    seed_three_albums(&store);

    // Pinned draws, one per requested row, each landing in a different album.
    // Reading a page from a single pivot would return three tracks of one.
    let mut pivots = [21_i64, 11, 1].into_iter();
    let (albums, _) = query_random_track_rows_with(
        &store,
        "t.album",
        &scoped_where(),
        3,
        |row| row.get::<_, String>(0),
        |_min, _max| pivots.next().unwrap_or(1),
    )
    .unwrap();

    let mut distinct = albums.clone();
    distinct.sort();
    distinct.dedup();
    assert_eq!(albums.len(), 3);
    assert_eq!(
        distinct.len(),
        3,
        "each pinned pivot must land in its own album, got {albums:?}"
    );
}

#[test]
fn random_sample_skips_a_repeated_pivot_instead_of_returning_it_twice() {
    let store = LibraryStore::open_in_memory();
    seed_three_albums(&store);

    // The same draw twice, then a different one: the duplicate is dropped and
    // the sample still fills, because the budget allows further attempts.
    let mut pivots = [5_i64, 5, 25].into_iter();
    let (ids, _) = query_random_track_rows_with(
        &store,
        "t.id",
        &scoped_where(),
        2,
        |row| row.get::<_, String>(0),
        |_min, _max| pivots.next().unwrap_or(25),
    )
    .unwrap();

    assert_eq!(ids.len(), 2);
    assert_ne!(ids[0], ids[1]);
}

#[test]
fn random_sample_stops_when_the_catalog_is_smaller_than_the_limit() {
    let store = LibraryStore::open_in_memory();
    TrackRepository::new(&store)
        .upsert_batch(&[track("s1", "only", "Song", "Artist", "Album")])
        .unwrap();

    let (ids, _) = query_random_track_rows_with(
        &store,
        "t.id",
        &scoped_where(),
        5,
        |row| row.get::<_, String>(0),
        |min, _max| min,
    )
    .unwrap();

    assert_eq!(ids, vec!["only".to_string()]);
}

#[test]
fn scoped_random_track_request_uses_bounded_sample_path() {
    let store = LibraryStore::open_in_memory();
    let tracks = (0..12)
        .map(|index| {
            scoped_track(
                "s1",
                &format!("t-{index:02}"),
                &format!("Song {index}"),
                "Artist",
                "Album",
                "album",
                if index % 2 == 0 { "lib-a" } else { "lib-b" },
                None,
                None,
                None,
            )
        })
        .collect::<Vec<_>>();
    TrackRepository::new(&store).upsert_batch(&tracks).unwrap();

    let mut r = req("s1", &[EntityKind::Track]);
    r.library_scopes = Some(vec![scope_pair("s1", "lib-a"), scope_pair("s1", "lib-b")]);
    r.sort = vec![LibrarySortClause {
        field: "random".into(),
        dir: SortDir::Asc,
    }];
    r.limit = 4;
    r.skip_totals = true;

    let response = run_advanced_search(&store, &r).unwrap();
    assert_eq!(response.tracks.len(), 4);
    assert_eq!(response.totals.tracks, 0);
}
