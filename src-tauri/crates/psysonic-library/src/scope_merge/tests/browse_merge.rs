#[test]
fn list_artists_collapses_collaboration_track_names_for_one_artist_id() {
    let store = LibraryStore::open_in_memory();
    TrackRepository::new(&store)
        .upsert_batch(&[
            track(
                "s1",
                "t1",
                "Song 1",
                Some("Andromida • Daedric"),
                "Album 1",
                "album-1",
                Some("artist-1"),
                200,
                "lib-a",
                None,
                None,
                None,
            ),
            track(
                "s1",
                "t2",
                "Song 2",
                Some("Andromida • Nevertel"),
                "Album 2",
                "album-2",
                Some("artist-1"),
                220,
                "lib-a",
                None,
                None,
                None,
            ),
        ])
        .unwrap();
    store
            .with_conn_mut("test.canonical_artist_scope", |conn| {
                conn.execute(
                    "INSERT INTO artist (server_id, id, name, synced_at) VALUES ('s1', 'artist-1', 'Andromida', 1)",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
    rebuild_cluster_keys(&store, Some("s1")).unwrap();

    let artists = list_artists(
        &store,
        &LibraryScopeListRequest {
            scopes: vec![scope_pair("s1", "lib-a"), scope_pair("s1", "lib-b")],
            sort: Some("name".into()),
            limit: Some(50),
            offset: Some(0),
        },
    )
    .unwrap();

    assert_eq!(
        artists
            .iter()
            .filter(|artist| artist.id == "artist-1")
            .count(),
        1
    );
}

#[test]
fn album_artist_browse_prefers_structured_id_over_same_name_rows() {
    let store = LibraryStore::open_in_memory();
    let mut row = track(
        "s1",
        "t1",
        "Song",
        Some("Blind Guardian"),
        "Album",
        "album-1",
        Some("track-performer"),
        200,
        "lib-a",
        None,
        None,
        None,
    );
    row.album_artist = Some("Blind Guardian".into());
    row.raw_json = serde_json::json!({
        "albumArtists": [
            { "id": "structured-id", "name": " Blind Guardian" }
        ]
    })
    .to_string();
    TrackRepository::new(&store).upsert_batch(&[row]).unwrap();
    store
        .with_conn_mut("test.album_artist_ids", |conn| {
            conn.execute_batch(
                "INSERT INTO artist (server_id, id, name, name_sort, name_fold, album_count, synced_at)
                 VALUES
                   ('s1', 'canonical-id', 'Blind Guardian', 'blind guardian', 'blind guardian', 313, 1),
                   ('s1', 'structured-id', 'Blind Guardian', 'blind guardian', 'blind guardian', 0, 1);",
            )?;
            Ok(())
        })
        .unwrap();

    let (artists, total) = list_index_artists_layer1_filtered(
        &store,
        "s1",
        &[scope_pair("s1", "lib-a")],
        true,
        "",
        &[],
        "ORDER BY ar.name COLLATE NOCASE ASC, ar.id ASC",
        50,
        0,
        false,
    )
    .unwrap();

    assert_eq!(total, 1);
    assert_eq!(artists.len(), 1);
    assert_eq!(artists[0].id, "structured-id");
    assert_eq!(artists[0].name, "Blind Guardian");
}

#[test]
fn artist_browse_modes_report_the_full_unique_credited_album_union() {
    let store = LibraryStore::open_in_memory();
    let mut own = track(
        "s1",
        "own-track",
        "Mirror Mirror",
        Some("Blind Guardian"),
        "Nightfall in Middle-Earth",
        "own-album",
        Some("blind-primary"),
        240,
        "lib-a",
        None,
        None,
        None,
    );
    own.raw_json = serde_json::json!({
        "artists": [{ "id": "blind-primary", "name": "Blind Guardian" }],
        "albumArtists": [{ "id": "blind-primary", "name": "Blind Guardian" }]
    })
    .to_string();
    let mut compilation = track(
        "s1",
        "compilation-track",
        "Beyond the Realms of Death",
        Some("Blind Guardian"),
        "A Tribute to Judas Priest",
        "compilation-album",
        Some("blind-primary"),
        240,
        "lib-a",
        None,
        None,
        None,
    );
    compilation.album_artist = Some("Various Artists".into());
    compilation.raw_json = serde_json::json!({
        "artists": [{ "id": "blind-primary", "name": "Blind Guardian" }],
        "albumArtists": [{ "id": "va", "name": "Various Artists" }],
        "isCompilation": true
    })
    .to_string();
    let mut alias = track(
        "s1",
        "alias-track",
        "The Dragonborn Comes",
        Some("Saltatio Mortis"),
        "Finsterwacht",
        "alias-album",
        Some("saltatio"),
        240,
        "lib-a",
        None,
        None,
        None,
    );
    alias.raw_json = serde_json::json!({
        "artists": [{ "id": "saltatio", "name": "Saltatio Mortis" }],
        "albumArtists": [{ "id": "blind-alias", "name": " Blind Guardian" }]
    })
    .to_string();
    seed_and_rebuild(&store, &[own, compilation, alias]);
    store
        .with_conn_mut("test.artist_union_count", |conn| {
            conn.execute_batch(
                "UPDATE artist SET name_sort = 'blind guardian', name_fold = 'blind guardian', album_count = 1 \
                 WHERE server_id = 's1' AND id = 'blind-primary'; \
                 INSERT INTO artist (server_id, id, name, name_sort, name_fold, album_count, synced_at) \
                 VALUES ('s1', 'blind-alias', ' Blind Guardian', 'blind guardian', 'blind guardian', 1, 1); \
                 INSERT INTO artist (server_id, id, name, name_sort, name_fold, album_count, synced_at) \
                 VALUES ('s1', 'va', 'Various Artists', 'various artists', 'various artists', 1, 1);",
            )?;
            Ok(())
        })
        .unwrap();
    let scopes = [scope_pair("s1", "lib-a")];

    let (track_mode, _) = list_artists_filtered(
        &store,
        &scopes,
        "psysonic_lower_name(t.artist) = ?",
        &[SqlValue::Text("blind guardian".into())],
        "ORDER BY artist COLLATE NOCASE ASC",
        10,
        0,
        true,
    )
    .unwrap();
    let (album_mode, _) = list_index_artists_multi_scope_album_filtered(
        &store,
        &scopes,
        "ar.name_fold = ?",
        &[SqlValue::Text("blind guardian".into())],
        "ORDER BY artist COLLATE NOCASE ASC",
        10,
        0,
        true,
    )
    .unwrap();

    assert_eq!(track_mode.len(), 1);
    assert_eq!(album_mode.len(), 1);
    assert_eq!(track_mode[0].album_count, Some(3));
    assert_eq!(album_mode[0].album_count, Some(3));
}

#[test]
fn album_merge_preserves_same_server_track_multiplicity_and_priority_winner_flips() {
    let store = LibraryStore::open_in_memory();
    let rows = [
        track(
            "s1",
            "t-a1",
            "Song",
            Some("Artist"),
            "Album",
            "alb-a",
            Some("art1"),
            200,
            "lib-a",
            Some(2001),
            Some("Rock"),
            Some("cover-a"),
        ),
        track(
            "s1",
            "t-b1",
            "Song",
            Some("Artist"),
            "Album",
            "alb-b",
            Some("art1"),
            200,
            "lib-b",
            Some(1999),
            Some("Pop"),
            Some("cover-b"),
        ),
    ];
    seed_and_rebuild(&store, &rows);

    let req_a_first = LibraryScopeListRequest {
        scopes: vec![scope_pair("s1", "lib-a"), scope_pair("s1", "lib-b")],
        sort: None,
        limit: Some(50),
        offset: Some(0),
    };
    let albums_a = list_albums(&store, &req_a_first).unwrap();
    assert_eq!(albums_a.len(), 1);
    assert_eq!(albums_a[0].id, "alb-a");
    assert_eq!(albums_a[0].year, Some(2001));
    assert_eq!(albums_a[0].genre.as_deref(), Some("Rock"));
    assert_eq!(albums_a[0].song_count, Some(2));
    assert_eq!(albums_a[0].duration_sec, Some(400));

    let req_b_first = LibraryScopeListRequest {
        scopes: vec![scope_pair("s1", "lib-b"), scope_pair("s1", "lib-a")],
        sort: None,
        limit: Some(50),
        offset: Some(0),
    };
    let albums_b = list_albums(&store, &req_b_first).unwrap();
    assert_eq!(albums_b.len(), 1);
    assert_eq!(albums_b[0].id, "alb-b");
    assert_eq!(albums_b[0].year, Some(1999));
    assert_eq!(albums_b[0].song_count, Some(2));
    assert_eq!(albums_b[0].duration_sec, Some(400));
}

#[test]
fn null_album_key_stays_individual() {
    let store = LibraryStore::open_in_memory();
    seed_and_rebuild(
        &store,
        &[
            track(
                "s1",
                "t1",
                "No Artist",
                None,
                "Al1",
                "alb1",
                None,
                100,
                "lib-a",
                None,
                None,
                None,
            ),
            track(
                "s1",
                "t2",
                "Also None",
                None,
                "Al2",
                "alb2",
                None,
                100,
                "lib-b",
                None,
                None,
                None,
            ),
        ],
    );
    let req = LibraryScopeListRequest {
        scopes: vec![scope_pair("s1", "lib-a"), scope_pair("s1", "lib-b")],
        sort: None,
        limit: Some(50),
        offset: None,
    };
    let albums = list_albums(&store, &req).unwrap();
    assert_eq!(albums.len(), 2);
}

#[test]
fn duration_guard_splits_cluster_key_group() {
    let store = LibraryStore::open_in_memory();
    seed_and_rebuild(
        &store,
        &[
            track(
                "s1",
                "t-short",
                "Same",
                Some("A"),
                "Al",
                "alb1",
                Some("ar1"),
                100,
                "lib-a",
                None,
                None,
                None,
            ),
            track(
                "s1",
                "t-long",
                "Same",
                Some("A"),
                "Al",
                "alb2",
                Some("ar1"),
                200,
                "lib-b",
                None,
                None,
                None,
            ),
        ],
    );
    let req = LibraryScopeSearchRequest {
        scopes: vec![scope_pair("s1", "lib-a"), scope_pair("s1", "lib-b")],
        query: "Same".into(),
        limit: Some(10),
    };
    let hits = search_tracks(&store, &req).unwrap();
    assert_eq!(hits.len(), 2);
}

#[test]
fn same_server_occurrences_survive_and_cross_server_sources_pair_by_rank() {
    let store = LibraryStore::open_in_memory();
    let mut rows = vec![
        track(
            "s1",
            "a1",
            "Tyrion",
            Some("Narrator"),
            "Book",
            "album-a",
            Some("narrator"),
            300,
            "lib-a",
            None,
            None,
            None,
        ),
        track(
            "s1",
            "a2",
            "Tyrion",
            Some("Narrator"),
            "Book",
            "album-a",
            Some("narrator"),
            300,
            "lib-a",
            None,
            None,
            None,
        ),
        track(
            "s2",
            "b1",
            "Tyrion",
            Some("Narrator"),
            "Book",
            "album-b",
            Some("narrator"),
            300,
            "lib-b",
            None,
            None,
            None,
        ),
        track(
            "s2",
            "b2",
            "Tyrion",
            Some("Narrator"),
            "Book",
            "album-b",
            Some("narrator"),
            300,
            "lib-b",
            None,
            None,
            None,
        ),
        track(
            "s3",
            "c1",
            "Tyrion",
            Some("Narrator"),
            "Book",
            "album-c",
            Some("narrator"),
            300,
            "lib-c",
            None,
            None,
            None,
        ),
    ];
    for (index, row) in rows.iter_mut().enumerate() {
        row.track_number = Some((index % 2 + 1) as i64);
        row.server_path = Some(format!("chapter-{}.mp3", index % 2 + 1));
    }
    seed_and_rebuild(&store, &rows);
    let scopes = vec![whole_scope("s1"), whole_scope("s2"), whole_scope("s3")];

    let detail = album_detail(
        &store,
        &LibraryScopeAlbumDetailRequest {
            scopes: scopes.clone(),
            album_id: "album-a".into(),
            server_id: "s1".into(),
        },
    )
    .unwrap();
    assert_eq!(
        detail
            .tracks
            .iter()
            .map(|track| track.id.as_str())
            .collect::<Vec<_>>(),
        vec!["a1", "a2"]
    );

    for (anchor_id, expected_ids) in [("a1", vec!["a1", "b1", "c1"]), ("a2", vec!["a2", "b2"])] {
        let sources = resolve_entity_sources(
            &store,
            &LibraryResolveEntitySourcesRequest {
                entity_type: LibrarySourceEntityType::Track,
                anchor_server_id: "s1".into(),
                anchor_id: anchor_id.into(),
                scopes: scopes.clone(),
            },
        )
        .unwrap();
        assert_eq!(
            sources
                .iter()
                .map(|source| source.id.as_str())
                .collect::<Vec<_>>(),
            expected_ids
        );
    }
}

#[test]
fn single_scope_returns_correct_album() {
    let store = LibraryStore::open_in_memory();
    seed_and_rebuild(
        &store,
        &[track(
            "s1",
            "t1",
            "Only",
            Some("A"),
            "Solo",
            "alb-solo",
            Some("ar1"),
            180,
            "lib-a",
            None,
            None,
            None,
        )],
    );
    let req = LibraryScopeListRequest {
        scopes: vec![scope_pair("s1", "lib-a")],
        sort: None,
        limit: Some(10),
        offset: None,
    };
    let albums = list_albums(&store, &req).unwrap();
    assert_eq!(albums.len(), 1);
    assert_eq!(albums[0].id, "alb-solo");
}

#[test]
fn pagination_and_order_stable() {
    let store = LibraryStore::open_in_memory();
    let rows = [
        track(
            "s1",
            "t1",
            "A",
            Some("X"),
            "Zebra",
            "alb-z",
            Some("ar1"),
            100,
            "lib-a",
            None,
            None,
            None,
        ),
        track(
            "s1",
            "t2",
            "B",
            Some("X"),
            "Alpha",
            "alb-a",
            Some("ar1"),
            100,
            "lib-a",
            None,
            None,
            None,
        ),
        track(
            "s1",
            "t3",
            "C",
            Some("X"),
            "Middle",
            "alb-m",
            Some("ar1"),
            100,
            "lib-a",
            None,
            None,
            None,
        ),
    ];
    seed_and_rebuild(&store, &rows);
    let req = LibraryScopeListRequest {
        scopes: vec![scope_pair("s1", "lib-a")],
        sort: None,
        limit: Some(2),
        offset: Some(1),
    };
    let page = list_albums(&store, &req).unwrap();
    assert_eq!(page.len(), 2);
    assert_eq!(page[0].name, "Middle");
    assert_eq!(page[1].name, "Zebra");
}
