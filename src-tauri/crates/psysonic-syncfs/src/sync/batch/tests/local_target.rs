//! A local folder may already hold the user's own music in the same naming
//! scheme. The planner must never adopt such a file, or a later run would
//! delete it as its own.

use super::super::payload::device_sync_source_key;
use super::super::plan::prepare_device_sync_plan;
use super::super::planner::{
    build_sync_plan_with_resume, FetchedDeviceSyncSource, SyncPlanOptions,
};
use super::super::{
    DeviceSyncLayoutMode, DeviceSyncManifestFile, DeviceSyncManifestPlaylist,
    DeviceSyncPlaylistPathMode, DeviceSyncTranscode, SyncDeltaResult,
};
use super::planner::{source, track, write_manifest};
use crate::sync::device::LOCAL_TARGET_MARKER;

const USER_FILE: &str = "Album Artist/Album/01 - Song.flac";

fn options() -> SyncPlanOptions {
    SyncPlanOptions {
        layout_mode: DeviceSyncLayoutMode::SharedAlbumTree,
        playlist_path_mode: DeviceSyncPlaylistPathMode::PlaylistRelative,
        transcode: DeviceSyncTranscode::default(),
    }
}

fn write_file(folder: &tempfile::TempDir, relative_path: &str) {
    let path = folder.path().join(relative_path);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, b"the user's own file").unwrap();
}

/// A confirmed local folder that already holds `USER_FILE`.
fn local_folder_with_user_file() -> tempfile::TempDir {
    let folder = tempfile::tempdir().unwrap();
    std::fs::write(folder.path().join(LOCAL_TARGET_MARKER), b"").unwrap();
    write_file(&folder, USER_FILE);
    folder
}

fn plan(
    folder: &tempfile::TempDir,
    fetched: &[FetchedDeviceSyncSource],
    deletion_ids: &[String],
    departed: &[(&str, serde_json::Value)],
) -> Result<SyncDeltaResult, String> {
    let departed = departed
        .iter()
        .map(|(id, song)| (id.to_string(), song.clone()))
        .collect();
    build_sync_plan_with_resume(
        fetched,
        deletion_ids,
        folder.path().to_str().unwrap(),
        options(),
        None,
        &departed,
    )
}

fn user_file_path(folder: &tempfile::TempDir) -> String {
    folder.path().join(USER_FILE).to_string_lossy().to_string()
}

fn mix_with(tracks: Vec<serde_json::Value>) -> Vec<FetchedDeviceSyncSource> {
    vec![FetchedDeviceSyncSource {
        source: source("playlist", "playlist-1", "Mix"),
        tracks,
    }]
}

#[test]
fn first_sync_refuses_a_user_file_at_a_planned_path() {
    let folder = local_folder_with_user_file();

    let error = plan(&folder, &mix_with(vec![track("track-1", "Song")]), &[], &[])
        .err()
        .unwrap();

    assert_eq!(
        error,
        format!("DEVICE_SYNC_PATH_IDENTITY_COLLISION:{USER_FILE}")
    );
    assert!(folder.path().join(USER_FILE).exists());
}

#[test]
fn removing_the_source_does_not_delete_a_user_file() {
    let folder = local_folder_with_user_file();
    let fetched = mix_with(vec![track("track-1", "Song")]);
    assert!(plan(&folder, &fetched, &[], &[]).is_err());

    let key = device_sync_source_key(&fetched[0].source);
    let removal = plan(&folder, &fetched, &[key], &[]).unwrap();

    assert!(!removal.delete_paths.contains(&user_file_path(&folder)));
    assert!(!removal
        .deferred_delete_paths
        .contains(&user_file_path(&folder)));
    assert!(removal.manifest_files.is_empty());
}

#[test]
fn a_track_leaving_the_playlist_does_not_delete_a_user_file() {
    let folder = local_folder_with_user_file();
    assert!(plan(&folder, &mix_with(vec![track("track-1", "Song")]), &[], &[]).is_err());

    let departed = plan(
        &folder,
        &mix_with(vec![]),
        &[],
        &[("track-1", track("track-1", "Song"))],
    )
    .unwrap();

    assert!(!departed.delete_paths.contains(&user_file_path(&folder)));
    assert!(!departed
        .deferred_delete_paths
        .contains(&user_file_path(&folder)));
}

#[test]
fn a_user_playlist_file_at_a_planned_path_is_refused() {
    let folder = tempfile::tempdir().unwrap();
    std::fs::write(folder.path().join(LOCAL_TARGET_MARKER), b"").unwrap();
    write_file(&folder, "Playlists/Mix/Mix.m3u8");

    let error = plan(&folder, &mix_with(vec![track("track-1", "Song")]), &[], &[])
        .err()
        .unwrap();

    assert_eq!(
        error,
        "DEVICE_SYNC_PATH_IDENTITY_COLLISION:Playlists/Mix/Mix.m3u8"
    );
}

#[test]
fn an_interrupted_first_sync_resumes_from_its_pending_plan() {
    let folder = tempfile::tempdir().unwrap();
    std::fs::write(folder.path().join(LOCAL_TARGET_MARKER), b"").unwrap();
    let fetched = mix_with(vec![track("track-1", "Song")]);
    let key = device_sync_source_key(&fetched[0].source);
    let mut first = plan(&folder, &fetched, &[], &[]).unwrap();
    assert_eq!(first.add_count, 1);
    prepare_device_sync_plan(
        folder.path(),
        "device-1",
        "server.test",
        vec![key],
        DeviceSyncLayoutMode::SharedAlbumTree,
        DeviceSyncPlaylistPathMode::PlaylistRelative,
        &mut first,
        None,
    )
    .unwrap();
    // The download finished, the run stopped before finalize.
    write_file(&folder, USER_FILE);

    let resumed = plan(&folder, &fetched, &[], &[]).unwrap();

    assert_eq!(resumed.add_count, 0);
    assert_eq!(resumed.manifest_files.len(), 1);
}

#[test]
fn files_the_manifest_records_are_still_cleaned_up() {
    let folder = tempfile::tempdir().unwrap();
    std::fs::write(folder.path().join(LOCAL_TARGET_MARKER), b"").unwrap();
    let fetched = mix_with(vec![track("track-1", "Song")]);
    let key = device_sync_source_key(&fetched[0].source);
    write_file(&folder, USER_FILE);
    write_file(&folder, "Playlists/Mix/Mix.m3u8");
    write_manifest(
        &folder,
        std::slice::from_ref(&fetched[0].source),
        DeviceSyncLayoutMode::SharedAlbumTree,
        &[DeviceSyncManifestFile {
            track_id: "track-1".to_string(),
            relative_path: USER_FILE.to_string(),
            source_keys: vec![key.clone()],
            size_bytes: 100,
            transcode: None,
            source: None,
        }],
        &[DeviceSyncManifestPlaylist {
            source_key: key.clone(),
            relative_path: "Playlists/Mix/Mix.m3u8".to_string(),
        }],
    );

    let unchanged = plan(&folder, &fetched, &[], &[]).unwrap();
    assert_eq!(unchanged.add_count, 0);

    let removal = plan(&folder, &fetched, &[key], &[]).unwrap();
    assert!(removal.delete_paths.contains(&user_file_path(&folder)));
}

#[test]
fn a_removable_drive_still_adopts_an_existing_copy() {
    let device = tempfile::tempdir().unwrap();
    write_file(&device, USER_FILE);

    let resumed = plan(&device, &mix_with(vec![track("track-1", "Song")]), &[], &[]).unwrap();

    assert_eq!(resumed.add_count, 0);
}
