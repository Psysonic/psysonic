use super::super::payload::device_sync_source_key;
use super::super::planner::{
    build_sync_plan, build_sync_plan_with_resume, FetchedDeviceSyncSource, SyncPlanOptions,
};
use super::super::{
    DeviceSyncLayoutMode, DeviceSyncManifestFile, DeviceSyncManifestPlaylist,
    DeviceSyncPlaylistPathMode, DeviceSyncSourceFingerprint, DeviceSyncSourcePayload,
    DeviceSyncTranscode, DeviceSyncTranscodeFormat, SyncDeltaResult,
};

fn source(source_type: &str, id: &str, name: &str) -> DeviceSyncSourcePayload {
    DeviceSyncSourcePayload {
        source_type: source_type.to_string(),
        id: id.to_string(),
        name: Some(name.to_string()),
        path_id: None,
        server_index_key: "server.test".to_string(),
    }
}

fn track(id: &str, title: &str) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "artist": "Artist",
        "albumArtist": "Album Artist",
        "album": "Album",
        "title": title,
        "track": 1,
        "suffix": "flac",
        "size": 100,
    })
}

fn write_manifest(
    device: &tempfile::TempDir,
    sources: &[DeviceSyncSourcePayload],
    layout_mode: DeviceSyncLayoutMode,
    files: &[DeviceSyncManifestFile],
    playlists: &[DeviceSyncManifestPlaylist],
) {
    let source_values = sources
        .iter()
        .map(|source| {
            serde_json::json!({
                "type": source.source_type,
                "id": source.id,
                "name": source.name,
                "pathId": source.path_id,
                "serverIndexKey": source.server_index_key,
            })
        })
        .collect::<Vec<_>>();
    std::fs::write(
        device.path().join("psysonic-sync.json"),
        serde_json::to_vec(&serde_json::json!({
            "version": 4,
            "schema": "fixed-v2",
            "ownerServerIndexKey": "server.test",
            "sources": source_values,
            "layoutMode": layout_mode,
            "playlistPathMode": "playlist-relative",
            "files": files,
            "playlists": playlists,
        }))
        .unwrap(),
    )
    .unwrap();
}

#[test]
fn shared_layout_keeps_playlist_order_but_plans_one_physical_file() {
    let device = tempfile::tempdir().unwrap();
    let fetched = vec![FetchedDeviceSyncSource {
        source: source("playlist", "playlist-1", "Mix"),
        tracks: vec![track("track-1", "Song"), track("track-1", "Song")],
    }];

    let plan = build_sync_plan(
        &fetched,
        &[],
        device.path().to_str().unwrap(),
        DeviceSyncLayoutMode::SharedAlbumTree,
        DeviceSyncPlaylistPathMode::DeviceRooted,
    )
    .unwrap();

    assert_eq!(plan.add_count, 1);
    assert_eq!(plan.manifest_files.len(), 1);
    assert_eq!(plan.playlists[0].tracks.len(), 2);
    assert_eq!(plan.playlists[0].references.len(), 2);
    assert_eq!(
        plan.playlists[0].references[0],
        "/Album Artist/Album/01 - Song.flac"
    );
    assert_eq!(
        plan.playlists[0].references[0],
        plan.playlists[0].references[1]
    );
}

#[test]
fn shared_layout_deduplicates_album_artist_and_playlist_sources() {
    let device = tempfile::tempdir().unwrap();
    let shared = track("track-1", "Song");
    let fetched = vec![
        FetchedDeviceSyncSource {
            source: source("album", "album-1", "Album"),
            tracks: vec![shared.clone()],
        },
        FetchedDeviceSyncSource {
            source: source("artist", "artist-1", "Artist"),
            tracks: vec![shared.clone()],
        },
        FetchedDeviceSyncSource {
            source: source("playlist", "playlist-1", "Mix"),
            tracks: vec![shared],
        },
    ];

    let plan = build_sync_plan(
        &fetched,
        &[],
        device.path().to_str().unwrap(),
        DeviceSyncLayoutMode::SharedAlbumTree,
        DeviceSyncPlaylistPathMode::PlaylistRelative,
    )
    .unwrap();

    assert_eq!(plan.add_count, 1);
    assert_eq!(plan.add_bytes, 100);
    assert_eq!(plan.manifest_files[0].source_keys.len(), 3);
    assert_eq!(
        plan.playlists[0].references,
        vec!["../../Album Artist/Album/01 - Song.flac"]
    );
}

#[test]
fn shared_file_survives_removing_one_of_its_sources() {
    let device = tempfile::tempdir().unwrap();
    let album = source("album", "album-1", "Album");
    let playlist = source("playlist", "playlist-1", "Mix");
    let album_key = device_sync_source_key(&album);
    let playlist_key = device_sync_source_key(&playlist);
    let relative_path = "Album Artist/Album/01 - Song.flac";
    std::fs::create_dir_all(device.path().join("Album Artist/Album")).unwrap();
    std::fs::write(device.path().join(relative_path), b"track").unwrap();
    write_manifest(
        &device,
        &[album.clone(), playlist.clone()],
        DeviceSyncLayoutMode::SharedAlbumTree,
        &[DeviceSyncManifestFile {
            track_id: "track-1".to_string(),
            relative_path: relative_path.to_string(),
            source_keys: vec![album_key.clone(), playlist_key.clone()],
            size_bytes: 100,
            transcode: None,
            source: None,
        }],
        &[DeviceSyncManifestPlaylist {
            source_key: playlist_key.clone(),
            relative_path: "Playlists/Mix/Mix.m3u8".to_string(),
        }],
    );
    let shared = track("track-1", "Song");
    let fetched = vec![
        FetchedDeviceSyncSource {
            source: album,
            tracks: vec![shared.clone()],
        },
        FetchedDeviceSyncSource {
            source: playlist,
            tracks: vec![shared],
        },
    ];

    let plan = build_sync_plan(
        &fetched,
        &[album_key],
        device.path().to_str().unwrap(),
        DeviceSyncLayoutMode::SharedAlbumTree,
        DeviceSyncPlaylistPathMode::PlaylistRelative,
    )
    .unwrap();

    assert!(plan.delete_paths.is_empty());
    assert!(plan.deferred_delete_paths.is_empty());
    assert_eq!(plan.manifest_files[0].source_keys, vec![playlist_key]);
}

#[test]
fn shared_file_survives_playlist_membership_change() {
    let device = tempfile::tempdir().unwrap();
    let album = source("album", "album-1", "Album");
    let playlist = source("playlist", "playlist-1", "Mix");
    let album_key = device_sync_source_key(&album);
    let playlist_key = device_sync_source_key(&playlist);
    let relative_path = "Album Artist/Album/01 - Song.flac";
    std::fs::create_dir_all(device.path().join("Album Artist/Album")).unwrap();
    std::fs::write(device.path().join(relative_path), b"track").unwrap();
    write_manifest(
        &device,
        &[album.clone(), playlist.clone()],
        DeviceSyncLayoutMode::SharedAlbumTree,
        &[DeviceSyncManifestFile {
            track_id: "track-1".to_string(),
            relative_path: relative_path.to_string(),
            source_keys: vec![album_key.clone(), playlist_key],
            size_bytes: 100,
            transcode: None,
            source: None,
        }],
        &[],
    );
    let fetched = vec![
        FetchedDeviceSyncSource {
            source: album,
            tracks: vec![track("track-1", "Song")],
        },
        FetchedDeviceSyncSource {
            source: playlist,
            tracks: Vec::new(),
        },
    ];

    let plan = build_sync_plan(
        &fetched,
        &[],
        device.path().to_str().unwrap(),
        DeviceSyncLayoutMode::SharedAlbumTree,
        DeviceSyncPlaylistPathMode::PlaylistRelative,
    )
    .unwrap();

    assert_eq!(plan.add_count, 0);
    assert!(plan.delete_paths.is_empty());
    assert_eq!(plan.manifest_files[0].source_keys, vec![album_key]);
}

#[test]
fn self_contained_to_shared_migration_moves_the_only_existing_copy() {
    let device = tempfile::tempdir().unwrap();
    let playlist = source("playlist", "playlist-1", "Mix");
    let playlist_key = device_sync_source_key(&playlist);
    let old_path = "Playlists/Mix/01 - Artist - Song.flac";
    std::fs::create_dir_all(device.path().join("Playlists/Mix")).unwrap();
    std::fs::write(device.path().join(old_path), b"track").unwrap();
    write_manifest(
        &device,
        std::slice::from_ref(&playlist),
        DeviceSyncLayoutMode::SelfContained,
        &[DeviceSyncManifestFile {
            track_id: "track-1".to_string(),
            relative_path: old_path.to_string(),
            source_keys: vec![playlist_key.clone()],
            size_bytes: 100,
            transcode: None,
            source: None,
        }],
        &[DeviceSyncManifestPlaylist {
            source_key: playlist_key,
            relative_path: "Playlists/Mix/Mix.m3u8".to_string(),
        }],
    );
    let fetched = vec![FetchedDeviceSyncSource {
        source: playlist,
        tracks: vec![track("track-1", "Song")],
    }];

    let plan = build_sync_plan(
        &fetched,
        &[],
        device.path().to_str().unwrap(),
        DeviceSyncLayoutMode::SharedAlbumTree,
        DeviceSyncPlaylistPathMode::PlaylistRelative,
    )
    .unwrap();

    // The existing copy is relocated rather than fetched again and deleted.
    assert_eq!(plan.add_count, 0);
    assert_eq!(plan.move_count, 1);
    assert_eq!(plan.move_paths[0].from, old_path);
    assert_eq!(plan.move_paths[0].to, "Album Artist/Album/01 - Song.flac");
    assert!(plan.delete_paths.is_empty());
    assert!(plan.deferred_delete_paths.is_empty());
    assert_eq!(plan.reclaimable_bytes, 0);
}

#[test]
fn active_plan_resumes_a_downloaded_file_not_yet_in_the_manifest() {
    let device = tempfile::tempdir().unwrap();
    let playlist = source("playlist", "playlist-1", "Mix");
    let playlist_key = device_sync_source_key(&playlist);
    let old_path = "Playlists/Mix/01 - Artist - Song.flac";
    let new_path = "Album Artist/Album/01 - Song.flac";
    std::fs::create_dir_all(device.path().join("Playlists/Mix")).unwrap();
    std::fs::create_dir_all(device.path().join("Album Artist/Album")).unwrap();
    std::fs::write(device.path().join(old_path), b"track").unwrap();
    std::fs::write(device.path().join(new_path), b"track").unwrap();
    write_manifest(
        &device,
        std::slice::from_ref(&playlist),
        DeviceSyncLayoutMode::SelfContained,
        &[DeviceSyncManifestFile {
            track_id: "track-1".to_string(),
            relative_path: old_path.to_string(),
            source_keys: vec![playlist_key.clone()],
            size_bytes: 100,
            transcode: None,
            source: None,
        }],
        &[],
    );
    let fetched = vec![FetchedDeviceSyncSource {
        source: playlist,
        tracks: vec![track("track-1", "Song")],
    }];
    let resume_files = vec![DeviceSyncManifestFile {
        track_id: "track-1".to_string(),
        relative_path: new_path.to_string(),
        source_keys: vec![playlist_key],
        size_bytes: 100,
        transcode: None,
        source: None,
    }];

    let plan = build_sync_plan_with_resume(
        &fetched,
        &[],
        device.path().to_str().unwrap(),
        SyncPlanOptions {
            layout_mode: DeviceSyncLayoutMode::SharedAlbumTree,
            playlist_path_mode: DeviceSyncPlaylistPathMode::DeviceRooted,
            ..SyncPlanOptions::default()
        },
        Some(&resume_files),
        &std::collections::HashMap::new(),
    )
    .unwrap();

    assert_eq!(plan.add_count, 0);
    assert_eq!(
        plan.delete_paths,
        vec![device.path().join(old_path).to_string_lossy().to_string()]
    );
}

#[test]
fn removing_the_final_playlist_deletes_its_track_and_m3u() {
    let device = tempfile::tempdir().unwrap();
    let playlist = source("playlist", "playlist-1", "Mix");
    let playlist_key = device_sync_source_key(&playlist);
    let track_path = "Album Artist/Album/01 - Song.flac";
    let playlist_path = "Playlists/Mix/Mix.m3u8";
    std::fs::create_dir_all(device.path().join("Album Artist/Album")).unwrap();
    std::fs::create_dir_all(device.path().join("Playlists/Mix")).unwrap();
    std::fs::write(device.path().join(track_path), b"track").unwrap();
    std::fs::write(device.path().join(playlist_path), b"#EXTM3U\n").unwrap();
    write_manifest(
        &device,
        std::slice::from_ref(&playlist),
        DeviceSyncLayoutMode::SharedAlbumTree,
        &[DeviceSyncManifestFile {
            track_id: "track-1".to_string(),
            relative_path: track_path.to_string(),
            source_keys: vec![playlist_key.clone()],
            size_bytes: 100,
            transcode: None,
            source: None,
        }],
        &[DeviceSyncManifestPlaylist {
            source_key: playlist_key.clone(),
            relative_path: playlist_path.to_string(),
        }],
    );
    let fetched = vec![FetchedDeviceSyncSource {
        source: playlist,
        tracks: vec![track("track-1", "Song")],
    }];

    let plan = build_sync_plan(
        &fetched,
        &[playlist_key],
        device.path().to_str().unwrap(),
        DeviceSyncLayoutMode::SharedAlbumTree,
        DeviceSyncPlaylistPathMode::PlaylistRelative,
    )
    .unwrap();

    assert_eq!(plan.del_count, 2);
    assert!(plan
        .delete_paths
        .contains(&device.path().join(track_path).to_string_lossy().to_string()));
    assert!(plan.delete_paths.contains(
        &device
            .path()
            .join(playlist_path)
            .to_string_lossy()
            .to_string()
    ));
    assert!(plan.manifest_files.is_empty());
    assert!(plan.manifest_playlists.is_empty());
}

#[test]
fn removing_a_legacy_source_derives_and_deletes_its_owned_files() {
    let device = tempfile::tempdir().unwrap();
    let album = source("album", "album-1", "Album");
    let album_key = device_sync_source_key(&album);
    let track_path = "Album Artist/Album/01 - Song.flac";
    std::fs::create_dir_all(device.path().join("Album Artist/Album")).unwrap();
    std::fs::write(device.path().join(track_path), b"track").unwrap();
    std::fs::write(
        device.path().join("psysonic-sync.json"),
        serde_json::to_vec(&serde_json::json!({
            "version": 3,
            "schema": "fixed-v1",
            "ownerServerIndexKey": "server.test",
            "sources": [{
                "type": "album",
                "id": "album-1",
                "name": "Album",
                "serverIndexKey": "server.test",
            }],
        }))
        .unwrap(),
    )
    .unwrap();
    let fetched = vec![FetchedDeviceSyncSource {
        source: album,
        tracks: vec![track("track-1", "Song")],
    }];

    let plan = build_sync_plan(
        &fetched,
        &[album_key],
        device.path().to_str().unwrap(),
        DeviceSyncLayoutMode::SharedAlbumTree,
        DeviceSyncPlaylistPathMode::PlaylistRelative,
    )
    .unwrap();

    assert_eq!(
        plan.delete_paths,
        vec![device.path().join(track_path).to_string_lossy().to_string()]
    );
}

#[test]
fn manifest_cannot_nominate_an_unrelated_device_file_for_deletion() {
    let device = tempfile::tempdir().unwrap();
    let album = source("album", "album-1", "Album");
    let album_key = device_sync_source_key(&album);
    let unrelated_path = "Private/Documents/keep-me.txt";
    std::fs::create_dir_all(device.path().join("Private/Documents")).unwrap();
    std::fs::write(device.path().join(unrelated_path), b"private").unwrap();
    write_manifest(
        &device,
        std::slice::from_ref(&album),
        DeviceSyncLayoutMode::SharedAlbumTree,
        &[DeviceSyncManifestFile {
            track_id: "track-1".to_string(),
            relative_path: unrelated_path.to_string(),
            source_keys: vec![album_key.clone()],
            size_bytes: 7,
            transcode: None,
            source: None,
        }],
        &[],
    );
    let fetched = vec![FetchedDeviceSyncSource {
        source: album,
        tracks: vec![track("track-1", "Song")],
    }];

    let plan = build_sync_plan(
        &fetched,
        &[album_key],
        device.path().to_str().unwrap(),
        DeviceSyncLayoutMode::SharedAlbumTree,
        DeviceSyncPlaylistPathMode::PlaylistRelative,
    )
    .unwrap();

    assert!(plan.delete_paths.is_empty());
    assert!(device.path().join(unrelated_path).exists());
}

#[test]
fn v4_manifest_does_not_delete_a_track_that_can_no_longer_be_derived() {
    let device = tempfile::tempdir().unwrap();
    let album = source("album", "album-1", "Album");
    let album_key = device_sync_source_key(&album);
    let old_path = "Album Artist/Album/01 - Removed.flac";
    std::fs::create_dir_all(device.path().join("Album Artist/Album")).unwrap();
    std::fs::write(device.path().join(old_path), b"old").unwrap();
    write_manifest(
        &device,
        std::slice::from_ref(&album),
        DeviceSyncLayoutMode::SharedAlbumTree,
        &[DeviceSyncManifestFile {
            track_id: "removed-track".to_string(),
            relative_path: old_path.to_string(),
            source_keys: vec![album_key],
            size_bytes: 3,
            transcode: None,
            source: None,
        }],
        &[],
    );
    let fetched = vec![FetchedDeviceSyncSource {
        source: album,
        tracks: vec![],
    }];

    let plan = build_sync_plan(
        &fetched,
        &[],
        device.path().to_str().unwrap(),
        DeviceSyncLayoutMode::SharedAlbumTree,
        DeviceSyncPlaylistPathMode::PlaylistRelative,
    )
    .unwrap();

    assert!(plan.delete_paths.is_empty());
    assert!(device.path().join(old_path).exists());
    assert_eq!(plan.manifest_files.len(), 1);
    assert_eq!(plan.manifest_files[0].track_id, "removed-track");
    assert_eq!(plan.manifest_files[0].relative_path, old_path);
}

#[test]
fn v4_manifest_drops_missing_unverifiable_ownership_from_the_replacement() {
    let device = tempfile::tempdir().unwrap();
    let album = source("album", "album-1", "Album");
    let album_key = device_sync_source_key(&album);
    let old_path = "Album Artist/Album/01 - Missing.flac";
    write_manifest(
        &device,
        std::slice::from_ref(&album),
        DeviceSyncLayoutMode::SharedAlbumTree,
        &[DeviceSyncManifestFile {
            track_id: "missing-track".to_string(),
            relative_path: old_path.to_string(),
            source_keys: vec![album_key],
            size_bytes: 3,
            transcode: None,
            source: None,
        }],
        &[],
    );
    let fetched = vec![FetchedDeviceSyncSource {
        source: album,
        tracks: vec![],
    }];

    let plan = build_sync_plan(
        &fetched,
        &[],
        device.path().to_str().unwrap(),
        DeviceSyncLayoutMode::SharedAlbumTree,
        DeviceSyncPlaylistPathMode::PlaylistRelative,
    )
    .unwrap();

    assert!(plan.delete_paths.is_empty());
    assert!(plan.manifest_files.is_empty());
}

#[test]
fn planner_rejects_a_different_track_at_an_owned_existing_path() {
    let device = tempfile::tempdir().unwrap();
    let album = source("album", "album-1", "Album");
    let album_key = device_sync_source_key(&album);
    let path = "Album Artist/Album/01 - Song.flac";
    std::fs::create_dir_all(device.path().join("Album Artist/Album")).unwrap();
    std::fs::write(device.path().join(path), b"old").unwrap();
    write_manifest(
        &device,
        std::slice::from_ref(&album),
        DeviceSyncLayoutMode::SharedAlbumTree,
        &[DeviceSyncManifestFile {
            track_id: "old-track".to_string(),
            relative_path: path.to_string(),
            source_keys: vec![album_key],
            size_bytes: 3,
            transcode: None,
            source: None,
        }],
        &[],
    );
    let fetched = vec![FetchedDeviceSyncSource {
        source: album,
        tracks: vec![track("new-track", "Song")],
    }];

    let result = build_sync_plan(
        &fetched,
        &[],
        device.path().to_str().unwrap(),
        DeviceSyncLayoutMode::SharedAlbumTree,
        DeviceSyncPlaylistPathMode::PlaylistRelative,
    );

    assert!(matches!(
        result,
        Err(error) if error.starts_with("DEVICE_SYNC_PATH_IDENTITY_COLLISION:")
    ));
}

#[test]
fn planner_rejects_case_insensitive_path_collisions() {
    let device = tempfile::tempdir().unwrap();
    let album = source("album", "album-1", "Album");
    let upper = track("track-1", "Song");
    let mut lower = track("track-2", "Song");
    lower["albumArtist"] = serde_json::json!("album artist");
    let fetched = vec![FetchedDeviceSyncSource {
        source: album,
        tracks: vec![upper, lower],
    }];

    let result = build_sync_plan(
        &fetched,
        &[],
        device.path().to_str().unwrap(),
        DeviceSyncLayoutMode::SharedAlbumTree,
        DeviceSyncPlaylistPathMode::PlaylistRelative,
    );

    assert!(matches!(
        result,
        Err(error) if error.starts_with("DEVICE_SYNC_PATH_COLLISION:")
    ));
}

#[cfg(unix)]
#[test]
fn planner_rejects_an_existing_track_path_behind_a_symlink() {
    use std::os::unix::fs::symlink;

    let device = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let album = source("album", "album-1", "Album");
    symlink(outside.path(), device.path().join("Album Artist")).unwrap();
    std::fs::create_dir_all(outside.path().join("Album")).unwrap();
    std::fs::write(outside.path().join("Album/01 - Song.flac"), b"track").unwrap();
    let fetched = vec![FetchedDeviceSyncSource {
        source: album,
        tracks: vec![track("track-1", "Song")],
    }];

    let result = build_sync_plan(
        &fetched,
        &[],
        device.path().to_str().unwrap(),
        DeviceSyncLayoutMode::SharedAlbumTree,
        DeviceSyncPlaylistPathMode::PlaylistRelative,
    );

    assert!(matches!(
        result,
        Err(error) if error == "DEVICE_SYNC_PLANNED_PATH_ESCAPES_ROOT"
    ));
}

#[cfg(unix)]
#[test]
fn planner_rejects_a_missing_track_path_behind_a_symlink() {
    use std::os::unix::fs::symlink;

    let device = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let album = source("album", "album-1", "Album");
    symlink(outside.path(), device.path().join("Album Artist")).unwrap();
    let fetched = vec![FetchedDeviceSyncSource {
        source: album,
        tracks: vec![track("track-1", "Song")],
    }];

    let result = build_sync_plan(
        &fetched,
        &[],
        device.path().to_str().unwrap(),
        DeviceSyncLayoutMode::SharedAlbumTree,
        DeviceSyncPlaylistPathMode::PlaylistRelative,
    );

    assert!(matches!(
        result,
        Err(error) if error == "DEVICE_SYNC_PLANNED_PATH_ESCAPES_ROOT"
    ));
}

#[test]
fn flat_layout_plans_root_files_and_a_root_playlist() {
    let device = tempfile::tempdir().unwrap();
    let shared = track("track-1", "Song");
    let fetched = vec![
        FetchedDeviceSyncSource {
            source: source("album", "album-1", "Album"),
            tracks: vec![shared.clone()],
        },
        FetchedDeviceSyncSource {
            source: source("playlist", "playlist-1", "Mix"),
            tracks: vec![shared],
        },
    ];

    let plan = build_sync_plan(
        &fetched,
        &[],
        device.path().to_str().unwrap(),
        DeviceSyncLayoutMode::Flat,
        DeviceSyncPlaylistPathMode::PlaylistRelative,
    )
    .unwrap();

    assert_eq!(plan.add_count, 1);
    assert_eq!(plan.manifest_files.len(), 1);
    assert_eq!(
        plan.manifest_files[0].relative_path,
        "Album Artist - Album - 01 - Song.flac"
    );
    assert_eq!(plan.manifest_files[0].source_keys.len(), 2);
    assert_eq!(plan.playlists[0].relative_path, "Mix.m3u8");
    assert_eq!(
        plan.playlists[0].references,
        vec!["Album Artist - Album - 01 - Song.flac"]
    );
    // The track handed to the batch writer carries the layout, so the path it
    // builds matches the one recorded above.
    assert_eq!(plan.tracks[0]["_flatLayout"], serde_json::json!(true));
    assert!(plan.tracks[0].get("_playlistName").is_none());
}

#[test]
fn flat_layout_can_reference_from_the_device_root() {
    let device = tempfile::tempdir().unwrap();
    let fetched = vec![FetchedDeviceSyncSource {
        source: source("playlist", "playlist-1", "Mix"),
        tracks: vec![track("track-1", "Song")],
    }];

    let plan = build_sync_plan(
        &fetched,
        &[],
        device.path().to_str().unwrap(),
        DeviceSyncLayoutMode::Flat,
        DeviceSyncPlaylistPathMode::DeviceRooted,
    )
    .unwrap();

    assert_eq!(
        plan.playlists[0].references,
        vec!["/Album Artist - Album - 01 - Song.flac"]
    );
}

#[test]
fn switching_to_flat_moves_the_album_tree_copy() {
    let device = tempfile::tempdir().unwrap();
    let album = source("album", "album-1", "Album");
    let tree_path = "Album Artist/Album/01 - Song.flac";
    std::fs::create_dir_all(device.path().join("Album Artist/Album")).unwrap();
    std::fs::write(device.path().join(tree_path), b"audio").unwrap();
    write_manifest(
        &device,
        std::slice::from_ref(&album),
        DeviceSyncLayoutMode::SharedAlbumTree,
        &[DeviceSyncManifestFile {
            track_id: "track-1".to_string(),
            relative_path: tree_path.to_string(),
            source_keys: vec![device_sync_source_key(&album)],
            size_bytes: 100,
            transcode: None,
            source: None,
        }],
        &[],
    );
    let fetched = vec![FetchedDeviceSyncSource {
        source: album,
        tracks: vec![track("track-1", "Song")],
    }];

    let plan = build_sync_plan(
        &fetched,
        &[],
        device.path().to_str().unwrap(),
        DeviceSyncLayoutMode::Flat,
        DeviceSyncPlaylistPathMode::PlaylistRelative,
    )
    .unwrap();

    assert_eq!(plan.add_count, 0);
    assert!(plan.delete_paths.is_empty());
    assert!(plan.deferred_delete_paths.is_empty());
    assert_eq!(plan.move_paths.len(), 1);
    assert_eq!(plan.move_paths[0].from, tree_path);
    assert_eq!(
        plan.move_paths[0].to,
        "Album Artist - Album - 01 - Song.flac"
    );
}

fn mp3(max_bit_rate_kbps: u32) -> DeviceSyncTranscode {
    DeviceSyncTranscode {
        format: DeviceSyncTranscodeFormat::Mp3,
        max_bit_rate_kbps,
    }
}

fn flac_fingerprint(size: u64) -> Option<DeviceSyncSourceFingerprint> {
    Some(DeviceSyncSourceFingerprint {
        size: Some(size),
        suffix: Some("flac".to_string()),
        bit_rate: None,
    })
}

fn manifest_file(
    track_id: &str,
    relative_path: &str,
    source_key: &str,
    transcode: Option<DeviceSyncTranscode>,
    source: Option<DeviceSyncSourceFingerprint>,
) -> DeviceSyncManifestFile {
    DeviceSyncManifestFile {
        track_id: track_id.to_string(),
        relative_path: relative_path.to_string(),
        source_keys: vec![source_key.to_string()],
        size_bytes: 100,
        transcode,
        source,
    }
}

fn plan_with(
    device: &tempfile::TempDir,
    fetched: &[FetchedDeviceSyncSource],
    options: SyncPlanOptions,
    departed: &[(&str, serde_json::Value)],
) -> SyncDeltaResult {
    let departed = departed
        .iter()
        .map(|(id, song)| (id.to_string(), song.clone()))
        .collect();
    build_sync_plan_with_resume(
        fetched,
        &[],
        device.path().to_str().unwrap(),
        options,
        None,
        &departed,
    )
    .unwrap()
}

fn shared_tree(transcode: DeviceSyncTranscode) -> SyncPlanOptions {
    SyncPlanOptions {
        layout_mode: DeviceSyncLayoutMode::SharedAlbumTree,
        playlist_path_mode: DeviceSyncPlaylistPathMode::PlaylistRelative,
        transcode,
    }
}

fn write_device_file(device: &tempfile::TempDir, relative_path: &str) {
    let path = device.path().join(relative_path);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, b"audio").unwrap();
}

#[test]
fn transcoding_plans_the_target_suffix_and_records_the_profile() {
    let device = tempfile::tempdir().unwrap();
    let album = source("album", "album-1", "Album");
    let mut song = track("track-1", "Song");
    song["duration"] = serde_json::json!(100);
    let fetched = vec![FetchedDeviceSyncSource {
        source: album,
        tracks: vec![song],
    }];

    let plan = plan_with(&device, &fetched, shared_tree(mp3(192)), &[]);

    assert_eq!(plan.add_count, 1);
    assert_eq!(plan.add_bytes, 100 * 192 * 1000 / 8);
    assert_eq!(plan.tracks[0]["suffix"], "mp3");
    assert_eq!(plan.tracks[0]["_sourceSuffix"], "flac");
    assert!(plan.tracks[0].get("_overwrite").is_none());
    assert_eq!(
        plan.manifest_files[0].relative_path,
        "Album Artist/Album/01 - Song.mp3"
    );
    assert_eq!(plan.manifest_files[0].transcode, Some(mp3(192)));
    assert_eq!(plan.manifest_files[0].source, flac_fingerprint(100));
}

#[test]
fn an_unchanged_transcoded_copy_is_kept() {
    let device = tempfile::tempdir().unwrap();
    let album = source("album", "album-1", "Album");
    let album_key = device_sync_source_key(&album);
    let path = "Album Artist/Album/01 - Song.mp3";
    write_device_file(&device, path);
    write_manifest(
        &device,
        std::slice::from_ref(&album),
        DeviceSyncLayoutMode::SharedAlbumTree,
        &[manifest_file(
            "track-1",
            path,
            &album_key,
            Some(mp3(320)),
            flac_fingerprint(100),
        )],
        &[],
    );
    let fetched = vec![FetchedDeviceSyncSource {
        source: album,
        tracks: vec![track("track-1", "Song")],
    }];

    let plan = plan_with(&device, &fetched, shared_tree(mp3(320)), &[]);

    assert_eq!(plan.add_count, 0);
    assert_eq!(plan.del_count, 0);
}

#[test]
fn a_new_bitrate_overwrites_the_copy_in_place() {
    let device = tempfile::tempdir().unwrap();
    let album = source("album", "album-1", "Album");
    let album_key = device_sync_source_key(&album);
    let path = "Album Artist/Album/01 - Song.mp3";
    write_device_file(&device, path);
    write_manifest(
        &device,
        std::slice::from_ref(&album),
        DeviceSyncLayoutMode::SharedAlbumTree,
        &[manifest_file(
            "track-1",
            path,
            &album_key,
            Some(mp3(320)),
            flac_fingerprint(100),
        )],
        &[],
    );
    let fetched = vec![FetchedDeviceSyncSource {
        source: album,
        tracks: vec![track("track-1", "Song")],
    }];

    let plan = plan_with(&device, &fetched, shared_tree(mp3(192)), &[]);

    assert_eq!(plan.add_count, 1);
    assert_eq!(plan.tracks[0]["_overwrite"], true);
    assert_eq!(plan.del_count, 0);
    assert_eq!(plan.manifest_files[0].transcode, Some(mp3(192)));
}

#[test]
fn a_source_file_replaced_on_the_server_is_fetched_again() {
    let device = tempfile::tempdir().unwrap();
    let album = source("album", "album-1", "Album");
    let album_key = device_sync_source_key(&album);
    let path = "Album Artist/Album/01 - Song.flac";
    write_device_file(&device, path);
    write_manifest(
        &device,
        std::slice::from_ref(&album),
        DeviceSyncLayoutMode::SharedAlbumTree,
        &[manifest_file(
            "track-1",
            path,
            &album_key,
            Some(DeviceSyncTranscode::default()),
            flac_fingerprint(50),
        )],
        &[],
    );
    let fetched = vec![FetchedDeviceSyncSource {
        source: album,
        tracks: vec![track("track-1", "Song")],
    }];

    let plan = plan_with(
        &device,
        &fetched,
        shared_tree(DeviceSyncTranscode::default()),
        &[],
    );

    assert_eq!(plan.add_count, 1);
    assert_eq!(plan.tracks[0]["_overwrite"], true);
    assert_eq!(plan.manifest_files[0].source, flac_fingerprint(100));
}

#[test]
fn copies_without_a_recorded_fingerprint_are_not_refreshed() {
    let device = tempfile::tempdir().unwrap();
    let album = source("album", "album-1", "Album");
    let album_key = device_sync_source_key(&album);
    let path = "Album Artist/Album/01 - Song.flac";
    write_device_file(&device, path);
    write_manifest(
        &device,
        std::slice::from_ref(&album),
        DeviceSyncLayoutMode::SharedAlbumTree,
        &[manifest_file("track-1", path, &album_key, None, None)],
        &[],
    );
    let fetched = vec![FetchedDeviceSyncSource {
        source: album,
        tracks: vec![track("track-1", "Song")],
    }];

    let plan = plan_with(
        &device,
        &fetched,
        shared_tree(DeviceSyncTranscode::default()),
        &[],
    );

    assert_eq!(plan.add_count, 0);
    assert_eq!(plan.manifest_files[0].source, flac_fingerprint(100));
}

#[test]
fn switching_back_to_originals_replaces_the_transcoded_copy() {
    let device = tempfile::tempdir().unwrap();
    let album = source("album", "album-1", "Album");
    let album_key = device_sync_source_key(&album);
    let mp3_path = "Album Artist/Album/01 - Song.mp3";
    write_device_file(&device, mp3_path);
    write_manifest(
        &device,
        std::slice::from_ref(&album),
        DeviceSyncLayoutMode::SharedAlbumTree,
        &[manifest_file(
            "track-1",
            mp3_path,
            &album_key,
            Some(mp3(320)),
            flac_fingerprint(100),
        )],
        &[],
    );
    let fetched = vec![FetchedDeviceSyncSource {
        source: album,
        tracks: vec![track("track-1", "Song")],
    }];

    let plan = plan_with(
        &device,
        &fetched,
        shared_tree(DeviceSyncTranscode::default()),
        &[],
    );

    assert_eq!(plan.add_count, 1);
    assert_eq!(plan.tracks[0]["suffix"], "flac");
    assert_eq!(plan.move_count, 0);
    assert_eq!(
        plan.deferred_delete_paths,
        vec![device.path().join(mp3_path).to_string_lossy().to_string()]
    );
}

#[test]
fn reordering_a_self_contained_playlist_moves_the_copies() {
    let device = tempfile::tempdir().unwrap();
    let playlist = source("playlist", "playlist-1", "Mix");
    let playlist_key = device_sync_source_key(&playlist);
    let first = "Playlists/Mix/01 - Artist - First.mp3";
    let second = "Playlists/Mix/02 - Artist - Second.mp3";
    write_device_file(&device, first);
    write_device_file(&device, second);
    write_manifest(
        &device,
        std::slice::from_ref(&playlist),
        DeviceSyncLayoutMode::SelfContained,
        &[
            manifest_file(
                "track-1",
                first,
                &playlist_key,
                Some(mp3(320)),
                flac_fingerprint(100),
            ),
            manifest_file(
                "track-2",
                second,
                &playlist_key,
                Some(mp3(320)),
                flac_fingerprint(100),
            ),
        ],
        &[],
    );
    let fetched = vec![FetchedDeviceSyncSource {
        source: playlist,
        tracks: vec![track("track-2", "Second"), track("track-1", "First")],
    }];

    let plan = plan_with(
        &device,
        &fetched,
        SyncPlanOptions {
            layout_mode: DeviceSyncLayoutMode::SelfContained,
            playlist_path_mode: DeviceSyncPlaylistPathMode::PlaylistRelative,
            transcode: mp3(320),
        },
        &[],
    );

    assert_eq!(plan.add_count, 0);
    assert_eq!(plan.del_count, 0);
    let mut moves = plan
        .move_paths
        .iter()
        .map(|planned| (planned.from.as_str(), planned.to.as_str()))
        .collect::<Vec<_>>();
    moves.sort();
    assert_eq!(
        moves,
        vec![
            (first, "Playlists/Mix/02 - Artist - First.mp3"),
            (second, "Playlists/Mix/01 - Artist - Second.mp3"),
        ]
    );
    assert_eq!(
        plan.playlists[0].references,
        vec!["01 - Artist - Second.mp3", "02 - Artist - First.mp3"]
    );
}

#[test]
fn a_track_removed_from_a_playlist_is_deleted_once_the_server_confirms_it() {
    let device = tempfile::tempdir().unwrap();
    let playlist = source("playlist", "playlist-1", "Mix");
    let playlist_key = device_sync_source_key(&playlist);
    let kept = "Album Artist/Album/01 - Kept.flac";
    let removed = "Album Artist/Album/01 - Removed.flac";
    write_device_file(&device, kept);
    write_device_file(&device, removed);
    write_manifest(
        &device,
        std::slice::from_ref(&playlist),
        DeviceSyncLayoutMode::SharedAlbumTree,
        &[
            manifest_file("track-1", kept, &playlist_key, None, None),
            manifest_file("track-2", removed, &playlist_key, None, None),
        ],
        &[],
    );
    let fetched = vec![FetchedDeviceSyncSource {
        source: playlist,
        tracks: vec![track("track-1", "Kept")],
    }];

    let without_lookup = plan_with(
        &device,
        &fetched,
        shared_tree(DeviceSyncTranscode::default()),
        &[],
    );
    assert_eq!(without_lookup.del_count, 0);

    let plan = plan_with(
        &device,
        &fetched,
        shared_tree(DeviceSyncTranscode::default()),
        &[("track-2", track("track-2", "Removed"))],
    );
    assert_eq!(
        plan.delete_paths,
        vec![device.path().join(removed).to_string_lossy().to_string()]
    );
    assert_eq!(plan.manifest_files.len(), 1);
    assert_eq!(plan.manifest_files[0].track_id, "track-1");
}

#[test]
fn a_server_song_cannot_vouch_for_an_unrelated_device_file() {
    let device = tempfile::tempdir().unwrap();
    let album = source("album", "album-1", "Album");
    let album_key = device_sync_source_key(&album);
    let unrelated = "Private/keep-me.mp3";
    write_device_file(&device, unrelated);
    write_manifest(
        &device,
        std::slice::from_ref(&album),
        DeviceSyncLayoutMode::SharedAlbumTree,
        &[manifest_file(
            "track-1",
            unrelated,
            &album_key,
            Some(mp3(320)),
            None,
        )],
        &[],
    );
    let fetched = vec![FetchedDeviceSyncSource {
        source: album,
        tracks: vec![],
    }];

    let plan = plan_with(
        &device,
        &fetched,
        shared_tree(DeviceSyncTranscode::default()),
        &[("track-1", track("track-1", "Song"))],
    );

    assert!(plan.delete_paths.is_empty());
    assert!(plan.deferred_delete_paths.is_empty());
    assert!(plan.move_paths.is_empty());
    assert!(device.path().join(unrelated).exists());
}

#[test]
fn absolute_mode_references_full_paths() {
    let device = tempfile::tempdir().unwrap();
    let playlist = source("playlist", "playlist-1", "Mix");
    let fetched = vec![FetchedDeviceSyncSource {
        source: playlist,
        tracks: vec![track("track-1", "Song")],
    }];

    for layout_mode in [
        DeviceSyncLayoutMode::SharedAlbumTree,
        DeviceSyncLayoutMode::SelfContained,
    ] {
        let plan = plan_with(
            &device,
            &fetched,
            SyncPlanOptions {
                layout_mode,
                playlist_path_mode: DeviceSyncPlaylistPathMode::Absolute,
                transcode: DeviceSyncTranscode::default(),
            },
            &[],
        );
        let expected = plan.manifest_files[0]
            .relative_path
            .split('/')
            .fold(device.path().to_path_buf(), |path, part| path.join(part));
        assert_eq!(
            plan.playlists[0].references,
            vec![expected.to_string_lossy().to_string()]
        );
    }
}
