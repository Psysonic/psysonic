use super::*;

#[test]
fn source_identity_includes_server_type_and_raw_id() {
    let album = DeviceSyncSourcePayload {
        source_type: "album".into(),
        id: "shared".into(),
        name: Some("Album".into()),
        path_id: None,
        server_index_key: "https://server-a.test".into(),
    };
    let mut playlist = album.clone();
    playlist.source_type = "playlist".into();
    let mut other_server = album.clone();
    other_server.server_index_key = "https://server-b.test".into();

    assert_ne!(
        device_sync_source_key(&album),
        device_sync_source_key(&playlist)
    );
    assert_ne!(
        device_sync_source_key(&album),
        device_sync_source_key(&other_server)
    );
}

#[test]
fn source_owner_must_match_the_captured_auth_owner() {
    let source = DeviceSyncSourcePayload {
        source_type: "album".into(),
        id: "album-1".into(),
        name: Some("Album".into()),
        path_id: None,
        server_index_key: "server-a.test".into(),
    };

    assert!(
        validate_device_sync_source_owners(std::slice::from_ref(&source), "server-a.test").is_ok()
    );
    assert_eq!(
        validate_device_sync_source_owners(&[source], "server-b.test"),
        Err("DEVICE_SYNC_SERVER_OWNER_MISMATCH".to_string()),
    );
}

#[test]
fn sources_marked_for_deletion_are_never_listed_from_the_server() {
    let source = |id: &str| DeviceSyncSourcePayload {
        source_type: "album".into(),
        id: id.into(),
        name: Some("Album".into()),
        path_id: None,
        server_index_key: "server-a.test".into(),
    };
    let removed = source("album-1");
    let kept = source("album-2");
    let deletion_keys = std::collections::HashSet::from([device_sync_source_key(&removed)]);

    // A delete-only run has no source left to list, which is what makes it
    // possible without reachable server credentials.
    assert!(!device_sync_source_requires_fetch(&removed, &deletion_keys));
    assert!(device_sync_source_requires_fetch(&kept, &deletion_keys));
    assert!(device_sync_source_requires_fetch(
        &removed,
        &std::collections::HashSet::new()
    ));
}

#[test]
fn sanitization_equivalent_playlist_names_receive_identity_suffixes() {
    let source = |id: &str, name: &str| DeviceSyncSourcePayload {
        source_type: "playlist".into(),
        id: id.into(),
        name: Some(name.into()),
        path_id: None,
        server_index_key: "server-a.test".into(),
    };
    let first = source("playlist-1", "Road/Trip");
    let second = source("playlist-2", "Road:Trip");
    let unique = source("playlist-3", "Workout");
    let collisions =
        playlist_collision_source_keys(&[first.clone(), second.clone(), unique.clone()]);

    assert!(collisions.contains(&device_sync_source_key(&first)));
    assert!(collisions.contains(&device_sync_source_key(&second)));
    assert!(!collisions.contains(&device_sync_source_key(&unique)));
}
