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
