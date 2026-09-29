use super::*;

#[test]
fn marking_a_folder_admits_it_as_a_sync_target() {
    let folder = tempfile::tempdir().unwrap();
    assert!(!inspect_device_sync_target_impl(folder.path()).local_target);

    mark_local_sync_target_impl(folder.path()).unwrap();

    let info = inspect_device_sync_target_impl(folder.path());
    assert!(info.exists);
    assert!(info.local_target);
    assert!(ensure_mounted_target(folder.path()).is_ok());
    // Marking twice is harmless.
    mark_local_sync_target_impl(folder.path()).unwrap();
}

#[test]
fn a_marked_parent_does_not_admit_its_subfolders() {
    let folder = tempfile::tempdir().unwrap();
    mark_local_sync_target_impl(folder.path()).unwrap();
    let child = folder.path().join("child");
    std::fs::create_dir(&child).unwrap();

    assert!(!inspect_device_sync_target_impl(&child).local_target);
}

#[test]
fn marking_refuses_missing_folders_files_and_the_filesystem_root() {
    let folder = tempfile::tempdir().unwrap();
    let file = folder.path().join("file.txt");
    std::fs::write(&file, b"x").unwrap();

    assert_eq!(
        mark_local_sync_target_impl(&folder.path().join("missing")),
        Err("VOLUME_NOT_FOUND".to_string())
    );
    assert_eq!(
        mark_local_sync_target_impl(&file),
        Err("VOLUME_NOT_FOUND".to_string())
    );
    let filesystem_root = std::path::Path::new(if cfg!(windows) { "C:\\" } else { "/" });
    assert_eq!(
        mark_local_sync_target_impl(filesystem_root),
        Err("DEVICE_SYNC_LOCAL_TARGET_INVALID".to_string())
    );
}

#[test]
fn marking_refuses_a_folder_that_already_holds_files() {
    let folder = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(folder.path().join("Album Artist/Album")).unwrap();
    std::fs::write(
        folder.path().join("Album Artist/Album/01 - Song.flac"),
        b"x",
    )
    .unwrap();

    assert!(!inspect_device_sync_target_impl(folder.path()).local_target_allowed);
    assert_eq!(
        mark_local_sync_target_impl(folder.path()),
        Err("DEVICE_SYNC_LOCAL_TARGET_NOT_EMPTY".to_string())
    );
    assert!(!is_marked_local_target(folder.path()));
}

#[test]
fn marking_ignores_operating_system_metadata() {
    let folder = tempfile::tempdir().unwrap();
    std::fs::write(folder.path().join(".DS_Store"), b"x").unwrap();
    std::fs::write(folder.path().join("desktop.ini"), b"x").unwrap();

    assert!(inspect_device_sync_target_impl(folder.path()).local_target_allowed);
    mark_local_sync_target_impl(folder.path()).unwrap();
}

#[test]
fn marking_accepts_a_folder_psysonic_already_synced_into() {
    let folder = tempfile::tempdir().unwrap();
    std::fs::write(folder.path().join("psysonic-sync.json"), b"{}").unwrap();
    std::fs::write(folder.path().join("01 - Song.flac"), b"x").unwrap();

    mark_local_sync_target_impl(folder.path()).unwrap();
    assert!(is_marked_local_target(folder.path()));
}

#[cfg(unix)]
#[test]
fn a_symlinked_marker_is_ignored() {
    let folder = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    std::fs::write(elsewhere.path().join("marker"), b"x").unwrap();
    std::os::unix::fs::symlink(
        elsewhere.path().join("marker"),
        folder.path().join(LOCAL_TARGET_MARKER),
    )
    .unwrap();

    assert!(!is_marked_local_target(folder.path()));
}

#[test]
fn available_space_is_reported_for_a_local_folder() {
    let folder = tempfile::tempdir().unwrap();
    assert!(target_available_space(folder.path()).is_some());
}
