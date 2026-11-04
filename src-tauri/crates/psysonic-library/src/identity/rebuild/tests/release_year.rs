use super::*;
use crate::identity::norm::KEY_SEP;

fn seed_artist(store: &LibraryStore, server: &str) {
    store
        .with_conn_mut("test.seed_artist", |conn| {
            conn.execute(
                "INSERT OR IGNORE INTO artist(server_id, id, name, synced_at) \
                 VALUES (?1, 'artist-1', 'Band', 1)",
                [server],
            )?;
            Ok(())
        })
        .unwrap();
}

fn release_track(server: &str, id: &str, album_id: &str, library_id: &str, year: i64) -> TrackRow {
    let mut row = physical_album_track_row(
        server, id, id, "Band", "artist-1", "Album", album_id, "Band", library_id,
    );
    row.year = Some(year);
    row
}

fn album_key(store: &LibraryStore, server: &str, track_id: &str) -> Option<String> {
    store
        .with_read_conn(|conn| read_cluster_row(conn, server, track_id))
        .unwrap()
        .unwrap()
        .1
}

fn projection_key(store: &LibraryStore, server: &str, album_id: &str) -> Option<String> {
    store
        .with_read_conn(|conn| {
            conn.query_row(
                "SELECT identity_key FROM album_browse_projection \
                 WHERE server_id = ?1 AND album_id = ?2",
                [server, album_id],
                |row| row.get(0),
            )
        })
        .unwrap()
}

fn base() -> String {
    format!("band{KEY_SEP}album")
}

fn with_year(year: i64) -> String {
    format!("band{KEY_SEP}album{KEY_SEP}@{year}")
}

#[test]
fn same_library_releases_with_different_years_get_their_own_keys() {
    let store = LibraryStore::open_in_memory();
    seed_artist(&store, "s1");
    TrackRepository::new(&store)
        .upsert_batch(&[
            release_track("s1", "t1", "original", "lib-a", 1991),
            release_track("s1", "t2", "original", "lib-a", 1991),
            release_track("s1", "t3", "reissue", "lib-a", 2021),
        ])
        .unwrap();

    rebuild_cluster_keys(&store, None).unwrap();

    assert_eq!(album_key(&store, "s1", "t1"), Some(with_year(1991)));
    assert_eq!(album_key(&store, "s1", "t2"), Some(with_year(1991)));
    assert_eq!(album_key(&store, "s1", "t3"), Some(with_year(2021)));
    assert_eq!(
        projection_key(&store, "s1", "original"),
        Some(with_year(1991))
    );
    assert_eq!(
        projection_key(&store, "s1", "reissue"),
        Some(with_year(2021))
    );
}

#[test]
fn copies_elsewhere_follow_the_split_and_join_their_release_year() {
    let store = LibraryStore::open_in_memory();
    seed_artist(&store, "s1");
    seed_artist(&store, "s2");
    TrackRepository::new(&store)
        .upsert_batch(&[
            release_track("s1", "t1", "original", "lib-a", 1991),
            release_track("s1", "t2", "reissue", "lib-a", 2021),
            release_track("s1", "t3", "flac-copy", "lib-b", 1991),
            release_track("s2", "t4", "remote-copy", "lib-x", 2021),
        ])
        .unwrap();

    rebuild_cluster_keys(&store, None).unwrap();

    assert_eq!(album_key(&store, "s1", "t3"), album_key(&store, "s1", "t1"));
    assert_eq!(album_key(&store, "s2", "t4"), album_key(&store, "s1", "t2"));
    assert_ne!(album_key(&store, "s1", "t1"), album_key(&store, "s1", "t2"));
}

#[test]
fn one_release_split_into_two_ids_keeps_one_key() {
    let store = LibraryStore::open_in_memory();
    seed_artist(&store, "s1");
    TrackRepository::new(&store)
        .upsert_batch(&[
            release_track("s1", "t1", "album-main", "lib-a", 2020),
            release_track("s1", "t2", "album-stray", "lib-a", 2020),
        ])
        .unwrap();

    rebuild_cluster_keys(&store, None).unwrap();

    assert_eq!(album_key(&store, "s1", "t1"), Some(base()));
    assert_eq!(album_key(&store, "s1", "t2"), Some(base()));
}

#[test]
fn copies_in_different_libraries_with_different_years_stay_merged() {
    let store = LibraryStore::open_in_memory();
    seed_artist(&store, "s1");
    TrackRepository::new(&store)
        .upsert_batch(&[
            release_track("s1", "t1", "album-a", "lib-a", 2001),
            release_track("s1", "t2", "album-b", "lib-b", 1999),
        ])
        .unwrap();

    rebuild_cluster_keys(&store, None).unwrap();

    assert_eq!(album_key(&store, "s1", "t1"), Some(base()));
    assert_eq!(album_key(&store, "s1", "t2"), Some(base()));
}

#[test]
fn an_added_reissue_splits_the_untouched_original_and_its_remote_copy() {
    let store = LibraryStore::open_in_memory();
    seed_artist(&store, "s1");
    seed_artist(&store, "s2");
    TrackRepository::new(&store)
        .upsert_batch(&[
            release_track("s1", "t1", "original", "lib-a", 1991),
            release_track("s2", "t9", "remote-copy", "lib-x", 1991),
        ])
        .unwrap();
    rebuild_cluster_keys(&store, None).unwrap();
    assert_eq!(album_key(&store, "s1", "t1"), Some(base()));

    TrackRepository::new(&store)
        .upsert_batch(&[release_track("s1", "t2", "reissue", "lib-a", 2021)])
        .unwrap();
    ensure_cluster_keys_built(&store, "s1").unwrap();

    assert_eq!(album_key(&store, "s1", "t1"), Some(with_year(1991)));
    assert_eq!(album_key(&store, "s1", "t2"), Some(with_year(2021)));
    assert_eq!(album_key(&store, "s2", "t9"), Some(with_year(1991)));
    assert_eq!(
        projection_key(&store, "s1", "original"),
        Some(with_year(1991))
    );
    assert_eq!(
        projection_key(&store, "s2", "remote-copy"),
        Some(with_year(1991))
    );
}

#[test]
fn a_removed_reissue_merges_the_original_back() {
    let store = LibraryStore::open_in_memory();
    seed_artist(&store, "s1");
    TrackRepository::new(&store)
        .upsert_batch(&[
            release_track("s1", "t1", "original", "lib-a", 1991),
            release_track("s1", "t2", "reissue", "lib-a", 2021),
        ])
        .unwrap();
    rebuild_cluster_keys(&store, None).unwrap();
    assert_eq!(album_key(&store, "s1", "t1"), Some(with_year(1991)));

    TrackRepository::new(&store)
        .tombstone_albums("s1", &["reissue".into()])
        .unwrap();
    ensure_cluster_keys_built(&store, "s1").unwrap();

    assert_eq!(album_key(&store, "s1", "t1"), Some(base()));
    assert_eq!(projection_key(&store, "s1", "original"), Some(base()));
}

#[test]
fn a_retitled_reissue_merges_the_original_back() {
    let store = LibraryStore::open_in_memory();
    seed_artist(&store, "s1");
    TrackRepository::new(&store)
        .upsert_batch(&[
            release_track("s1", "t1", "original", "lib-a", 1991),
            release_track("s1", "t2", "reissue", "lib-a", 2021),
        ])
        .unwrap();
    rebuild_cluster_keys(&store, None).unwrap();
    assert_eq!(album_key(&store, "s1", "t1"), Some(with_year(1991)));

    let mut retitled = release_track("s1", "t2", "reissue", "lib-a", 2021);
    retitled.album = "Album Live".into();
    TrackRepository::new(&store)
        .upsert_batch(&[retitled])
        .unwrap();
    ensure_cluster_keys_built(&store, "s1").unwrap();

    assert_eq!(album_key(&store, "s1", "t1"), Some(base()));
    assert_eq!(projection_key(&store, "s1", "original"), Some(base()));
}

#[test]
fn a_server_rebuild_updates_the_split_on_other_servers() {
    let store = LibraryStore::open_in_memory();
    seed_artist(&store, "s1");
    seed_artist(&store, "s2");
    TrackRepository::new(&store)
        .upsert_batch(&[
            release_track("s1", "t1", "original", "lib-a", 1991),
            release_track("s1", "t2", "reissue", "lib-a", 2021),
            release_track("s2", "t9", "remote-copy", "lib-x", 1991),
        ])
        .unwrap();
    rebuild_cluster_keys(&store, None).unwrap();
    assert_eq!(album_key(&store, "s2", "t9"), Some(with_year(1991)));

    store
        .with_conn_mut("test.drop_reissue", |conn| {
            conn.execute(
                "UPDATE track SET deleted = 1 WHERE server_id = 's1' AND album_id = 'reissue'",
                [],
            )?;
            Ok(())
        })
        .unwrap();
    rebuild_cluster_keys(&store, Some("s1")).unwrap();

    assert_eq!(album_key(&store, "s1", "t1"), Some(base()));
    assert_eq!(album_key(&store, "s2", "t9"), Some(base()));
    assert_eq!(projection_key(&store, "s2", "remote-copy"), Some(base()));
}

/// Navidrome's native song JSON carries the edition's own year as
/// `releaseYear`, while `year` follows the original date.
fn reissue_tagged_with_original_year(
    server: &str,
    id: &str,
    album_id: &str,
    library_id: &str,
    year: i64,
    release_year: i64,
) -> TrackRow {
    let mut row = release_track(server, id, album_id, library_id, year);
    row.raw_json =
        serde_json::json!({ "releaseYear": release_year, "originalYear": year }).to_string();
    row
}

#[test]
fn a_reissue_tagged_with_the_original_year_splits_on_its_release_year() {
    let store = LibraryStore::open_in_memory();
    seed_artist(&store, "s1");
    TrackRepository::new(&store)
        .upsert_batch(&[
            release_track("s1", "t1", "original", "lib-a", 1996),
            reissue_tagged_with_original_year("s1", "t2", "reissue", "lib-a", 1996, 2026),
        ])
        .unwrap();

    rebuild_cluster_keys(&store, None).unwrap();

    assert_eq!(album_key(&store, "s1", "t1"), Some(with_year(1996)));
    assert_eq!(album_key(&store, "s1", "t2"), Some(with_year(2026)));
    assert_eq!(
        projection_key(&store, "s1", "reissue"),
        Some(with_year(2026))
    );
}

#[test]
fn an_added_reissue_with_a_release_year_splits_through_the_journal() {
    let store = LibraryStore::open_in_memory();
    seed_artist(&store, "s1");
    TrackRepository::new(&store)
        .upsert_batch(&[release_track("s1", "t1", "original", "lib-a", 1996)])
        .unwrap();
    rebuild_cluster_keys(&store, None).unwrap();
    assert_eq!(album_key(&store, "s1", "t1"), Some(base()));

    TrackRepository::new(&store)
        .upsert_batch(&[reissue_tagged_with_original_year(
            "s1", "t2", "reissue", "lib-a", 1996, 2026,
        )])
        .unwrap();
    ensure_cluster_keys_built(&store, "s1").unwrap();

    assert_eq!(album_key(&store, "s1", "t1"), Some(with_year(1996)));
    assert_eq!(album_key(&store, "s1", "t2"), Some(with_year(2026)));
}

/// Known limitation, pinned so a change to it is deliberate: Subsonic-shaped
/// song JSON (scoped and large initial Navidrome syncs, plain Subsonic
/// servers) carries no `releaseYear`, only the year tag. A copy of the
/// reissue read that way keys on the original's year and joins the original.
#[test]
fn a_subsonic_copy_of_a_reissue_tagged_with_the_original_year_joins_the_original() {
    let store = LibraryStore::open_in_memory();
    seed_artist(&store, "s1");
    seed_artist(&store, "s2");
    let mut subsonic_copy = release_track("s2", "t3", "remote-reissue", "lib-x", 1996);
    subsonic_copy.raw_json = serde_json::json!({ "year": 1996, "mediaType": "song" }).to_string();
    TrackRepository::new(&store)
        .upsert_batch(&[
            release_track("s1", "t1", "original", "lib-a", 1996),
            reissue_tagged_with_original_year("s1", "t2", "reissue", "lib-a", 1996, 2026),
            subsonic_copy,
        ])
        .unwrap();

    rebuild_cluster_keys(&store, None).unwrap();

    assert_eq!(album_key(&store, "s1", "t2"), Some(with_year(2026)));
    assert_eq!(album_key(&store, "s2", "t3"), Some(with_year(1996)));
    assert_eq!(album_key(&store, "s2", "t3"), album_key(&store, "s1", "t1"));
}

#[test]
fn a_matching_release_year_keeps_one_release_on_one_key() {
    let store = LibraryStore::open_in_memory();
    seed_artist(&store, "s1");
    TrackRepository::new(&store)
        .upsert_batch(&[
            reissue_tagged_with_original_year("s1", "t1", "album-main", "lib-a", 1996, 2026),
            reissue_tagged_with_original_year("s1", "t2", "album-stray", "lib-a", 1996, 2026),
        ])
        .unwrap();

    rebuild_cluster_keys(&store, None).unwrap();

    assert_eq!(album_key(&store, "s1", "t1"), Some(base()));
    assert_eq!(album_key(&store, "s1", "t2"), Some(base()));
}

/// The member CTE is a literal its callers splice into their own SQL, so it
/// spells the year expression out instead of formatting it in.
#[test]
fn the_member_cte_uses_the_shared_release_year_expression() {
    let cte = crate::identity::RELEASE_MEMBER_CTE_SQL;
    let year = crate::identity::TRACK_RELEASE_YEAR_SQL;
    assert!(
        cte.contains(&format!("{year} AS year")),
        "RELEASE_MEMBER_CTE_SQL no longer matches TRACK_RELEASE_YEAR_SQL"
    );
}

#[test]
fn a_copy_without_a_year_keeps_the_base_key_beside_a_split() {
    let store = LibraryStore::open_in_memory();
    seed_artist(&store, "s1");
    seed_artist(&store, "s2");
    TrackRepository::new(&store)
        .upsert_batch(&[
            release_track("s1", "t1", "original", "lib-a", 1991),
            release_track("s1", "t2", "reissue", "lib-a", 2021),
            release_track("s2", "t9", "untagged-copy", "lib-x", 0),
        ])
        .unwrap();

    rebuild_cluster_keys(&store, None).unwrap();

    // No year says which release this copy is, so it is not guessed into one.
    assert_eq!(album_key(&store, "s2", "t9"), Some(base()));
    assert_eq!(album_key(&store, "s1", "t1"), Some(with_year(1991)));
    assert_eq!(album_key(&store, "s1", "t2"), Some(with_year(2021)));
}
