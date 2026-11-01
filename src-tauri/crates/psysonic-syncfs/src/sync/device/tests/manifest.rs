use super::*;

static MANIFEST_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn manifest_input(path: &std::path::Path) -> DeviceManifestWrite {
    DeviceManifestWrite {
        dest_dir: path.to_string_lossy().to_string(),
        owner_server_index_key: "server.test".to_string(),
        owner_server_profile_id: None,
        sources: serde_json::json!([]),
        canonical_id_version: Some(1),
        layout_mode: None,
        playlist_path_mode: None,
        files: None,
        playlists: None,
    }
}

#[tokio::test]
async fn manifest_v4_persists_the_server_owner_and_layout() {
    let _test_guard = MANIFEST_TEST_LOCK.lock().await;
    let dir = tempfile::tempdir().unwrap();
    let owner = "server.test";
    let sources = serde_json::json!([{
        "type": "album",
        "id": "album-1",
        "name": "Album",
        "serverIndexKey": owner,
    }]);

    write_device_manifest_for_migration(
        dir.path().to_string_lossy().to_string(),
        owner.to_string(),
        sources.clone(),
        Some(1),
    )
    .unwrap();

    let manifest = read_device_manifest(dir.path().to_string_lossy().to_string()).unwrap();
    assert_eq!(manifest["version"], 4);
    assert_eq!(manifest["schema"], "fixed-v2");
    assert_eq!(manifest["ownerServerIndexKey"], owner);
    assert_eq!(manifest["sources"], sources);
    assert_eq!(manifest["canonicalIdVersion"], 1);
    assert_eq!(manifest["layoutMode"], "self-contained");
    assert_eq!(manifest["playlistPathMode"], "playlist-relative");
    assert!(manifest.get("files").is_none());
    assert!(manifest.get("playlists").is_none());
}

#[test]
fn manifest_v4_persists_the_materialized_shared_file_plan() {
    let dir = tempfile::tempdir().unwrap();
    let owner = "server.test";
    let sources = serde_json::json!([{
        "type": "playlist",
        "id": "playlist-1",
        "name": "Mix",
        "serverIndexKey": owner,
    }]);
    let files = serde_json::json!([{
        "trackId": "track-1",
        "relativePath": "Artist/Album/01 - Song.flac",
        "sourceKeys": [serde_json::to_string(&(owner, "playlist", "playlist-1")).unwrap()],
        "sizeBytes": 100,
    }]);
    let playlists = serde_json::json!([{
        "sourceKey": serde_json::to_string(&(owner, "playlist", "playlist-1")).unwrap(),
        "relativePath": "Playlists/Mix/Mix.m3u8",
    }]);

    write_device_manifest_payload(DeviceManifestWrite {
        dest_dir: dir.path().to_string_lossy().to_string(),
        owner_server_index_key: owner.to_string(),
        owner_server_profile_id: None,
        sources,
        canonical_id_version: Some(1),
        layout_mode: Some("shared-album-tree".to_string()),
        playlist_path_mode: Some("device-rooted".to_string()),
        files: Some(files.clone()),
        playlists: Some(playlists.clone()),
    })
    .unwrap();

    let manifest = read_device_manifest(dir.path().to_string_lossy().to_string()).unwrap();
    assert_eq!(manifest["layoutMode"], "shared-album-tree");
    assert_eq!(manifest["playlistPathMode"], "device-rooted");
    assert_eq!(manifest["files"], files);
    assert_eq!(manifest["playlists"], playlists);
}

#[test]
fn canonical_migration_rewrites_materialized_manifest_ids() {
    let dir = tempfile::tempdir().unwrap();
    let owner = "server.test";
    let previous_owner = "legacy-profile.test";
    let legacy_track = "01234567-89ab-cdef-0123-456789abcdef";
    let legacy_playlist = "fedcba98-7654-3210-fedc-ba9876543210";
    let canonical_track = psysonic_core::navidrome_id_codec::canonical_id(legacy_track);
    let canonical_playlist = psysonic_core::navidrome_id_codec::canonical_id(legacy_playlist);
    let legacy_source_key =
        serde_json::to_string(&(previous_owner, "playlist", legacy_playlist)).unwrap();

    write_device_manifest_payload(DeviceManifestWrite {
        dest_dir: dir.path().to_string_lossy().to_string(),
        owner_server_index_key: previous_owner.to_string(),
        owner_server_profile_id: None,
        sources: serde_json::json!([{
            "type": "playlist",
            "id": legacy_playlist,
            "name": "Mix",
            "serverIndexKey": previous_owner,
        }]),
        canonical_id_version: None,
        layout_mode: Some("shared-album-tree".to_string()),
        playlist_path_mode: Some("device-rooted".to_string()),
        files: Some(serde_json::json!([{
            "trackId": legacy_track,
            "relativePath": "Artist/Album/01 - Song.flac",
            "sourceKeys": [legacy_source_key],
            "sizeBytes": 100,
        }])),
        playlists: Some(serde_json::json!([{
            "sourceKey": serde_json::to_string(&(previous_owner, "playlist", legacy_playlist)).unwrap(),
            "relativePath": "Playlists/Mix/Mix.m3u8",
        }])),
    })
    .unwrap();

    write_device_manifest_for_migration(
        dir.path().to_string_lossy().to_string(),
        owner.to_string(),
        serde_json::json!([{
            "type": "playlist",
            "id": canonical_playlist,
            "name": "Mix",
            "serverIndexKey": owner,
        }]),
        Some(1),
    )
    .unwrap();

    let manifest = read_device_manifest(dir.path().to_string_lossy().to_string()).unwrap();
    let canonical_source_key =
        serde_json::to_string(&(owner, "playlist", canonical_playlist)).unwrap();
    assert_eq!(manifest["files"][0]["trackId"], canonical_track);
    assert_eq!(manifest["files"][0]["sourceKeys"][0], canonical_source_key);
    assert_eq!(manifest["playlists"][0]["sourceKey"], canonical_source_key);
}

#[tokio::test]
async fn manifest_rejects_sources_from_another_server() {
    let _test_guard = MANIFEST_TEST_LOCK.lock().await;
    let dir = tempfile::tempdir().unwrap();
    let result = write_device_manifest_for_migration(
        dir.path().to_string_lossy().to_string(),
        "server-a.test".to_string(),
        serde_json::json!([{
            "type": "album",
            "id": "album-1",
            "name": "Album",
            "serverIndexKey": "server-b.test",
        }]),
        None,
    );

    assert_eq!(result, Err("DEVICE_SYNC_SERVER_OWNER_MISMATCH".to_string()));
}

#[tokio::test]
async fn ordinary_manifest_write_rejects_a_host_directory() {
    let _test_guard = MANIFEST_TEST_LOCK.lock().await;
    let dir = tempfile::tempdir().unwrap();
    let result =
        super::super::manifest::write_device_manifest_guarded(manifest_input(dir.path()), || {
            vec![root_disk(dir.path())]
        })
        .await;

    assert_eq!(result, Err("NOT_MOUNTED_VOLUME".to_string()));
    assert!(!dir.path().join("psysonic-sync.json").exists());
}

#[tokio::test]
async fn ordinary_manifest_write_accepts_a_non_removable_non_root_mount() {
    let _test_guard = MANIFEST_TEST_LOCK.lock().await;
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("Music");
    std::fs::create_dir(&target).unwrap();
    super::super::manifest::write_device_manifest_guarded(manifest_input(&target), || {
        vec![root_disk(dir.path()), mounted_disk(dir.path(), false, 100)]
    })
    .await
    .unwrap();

    let manifest = read_device_manifest(target.to_string_lossy().to_string()).unwrap();
    assert_eq!(manifest["version"], 4);
    assert_eq!(manifest["ownerServerIndexKey"], "server.test");
    assert_eq!(manifest["sources"], serde_json::json!([]));
    assert_eq!(manifest["canonicalIdVersion"], 1);
    assert!(!is_marked_local_target(&target));
}

#[tokio::test]
async fn ordinary_manifest_write_accepts_an_explicit_local_target() {
    let _test_guard = MANIFEST_TEST_LOCK.lock().await;
    let dir = tempfile::tempdir().unwrap();
    mark_local_sync_target_impl(dir.path()).unwrap();
    super::super::manifest::write_device_manifest_guarded(manifest_input(dir.path()), || {
        vec![root_disk(dir.path())]
    })
    .await
    .unwrap();
    assert!(read_device_manifest(dir.path().to_string_lossy().to_string()).is_some());
}

#[tokio::test]
async fn ordinary_manifest_write_checks_the_volume_before_the_payload() {
    let _test_guard = MANIFEST_TEST_LOCK.lock().await;
    let dir = tempfile::tempdir().unwrap();
    let mut input = manifest_input(dir.path());
    input.owner_server_index_key.clear();
    assert_eq!(
        super::super::manifest::write_device_manifest_guarded(input, Vec::new).await,
        Err("NOT_MOUNTED_VOLUME".to_string())
    );
    assert!(!dir.path().join("psysonic-sync.json").exists());
}

#[cfg(unix)]
#[tokio::test]
async fn ordinary_manifest_write_does_not_follow_a_manifest_symlink() {
    let _test_guard = MANIFEST_TEST_LOCK.lock().await;
    let dir = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let outside = elsewhere.path().join("manifest.json");
    std::fs::write(&outside, b"{}").unwrap();
    std::os::unix::fs::symlink(&outside, dir.path().join("psysonic-sync.json")).unwrap();
    assert_eq!(
        super::super::manifest::write_device_manifest_guarded(manifest_input(dir.path()), || {
            vec![mounted_disk(dir.path(), false, 100)]
        })
        .await,
        Err("DEVICE_SYNC_PATH_ESCAPES_ROOT".to_string())
    );
    assert_eq!(std::fs::read(&outside).unwrap(), b"{}");
    assert!(
        std::fs::symlink_metadata(dir.path().join("psysonic-sync.json"))
            .unwrap()
            .file_type()
            .is_symlink()
    );
}

#[tokio::test]
async fn manifest_write_is_rejected_while_migration_is_active() {
    let _test_guard = MANIFEST_TEST_LOCK.lock().await;
    let dir = tempfile::tempdir().unwrap();
    crate::activate_filesystem_migration_generation(8_001)
        .await
        .unwrap();

    let result = write_device_manifest(
        dir.path().to_string_lossy().to_string(),
        "server.test".to_string(),
        None,
        serde_json::json!([{
            "type": "album",
            "id": "album-1",
            "name": "Album",
            "serverIndexKey": "server.test",
        }]),
        Some(1),
        None,
        None,
        None,
        None,
    )
    .await;
    let guarded_result = super::super::manifest::write_device_manifest_guarded(
        manifest_input(dir.path()),
        unexpected_inventory,
    )
    .await;
    crate::deactivate_filesystem_migration_generation(8_001).unwrap();

    assert!(result.unwrap_err().contains("migration generation 8001"));
    assert!(guarded_result
        .unwrap_err()
        .contains("migration generation 8001"));
    assert!(!dir.path().join("psysonic-sync.json").exists());
}
