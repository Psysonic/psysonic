use super::*;

struct MountedDisk {
    mount_point: std::path::PathBuf,
    is_removable: bool,
    available_space: u64,
}

impl mounts::MountEntry for MountedDisk {
    fn mount_point(&self) -> &std::path::Path {
        &self.mount_point
    }

    fn is_removable(&self) -> bool {
        self.is_removable
    }

    fn available_space(&self) -> u64 {
        self.available_space
    }
}

impl mounts::MountInventory for Vec<MountedDisk> {
    type Entry = MountedDisk;

    fn list(&self) -> &[Self::Entry] {
        self
    }
}

fn unexpected_inventory() -> Vec<MountedDisk> {
    panic!("enumerated before checking a filesystem precondition")
}

fn mounted_disk(path: &std::path::Path, is_removable: bool, available_space: u64) -> MountedDisk {
    MountedDisk {
        mount_point: path.to_path_buf(),
        is_removable,
        available_space,
    }
}

fn root_disk(path: &std::path::Path) -> MountedDisk {
    // TEMP may resolve through a junction onto another drive.
    let canonical = path.canonicalize().unwrap();
    let root = canonical.ancestors().last().unwrap();
    // sysinfo reports Windows drive roots without the canonical verbatim prefix.
    let root = std::path::PathBuf::from(root.to_string_lossy().trim_start_matches(r"\\?\"));
    mounted_disk(&root, false, 1_000)
}

#[test]
fn mounted_target_requires_a_non_root_inventory_entry() {
    let folder = tempfile::tempdir().unwrap();
    assert_eq!(
        mounts::ensure_mounted_target_with(folder.path(), || vec![root_disk(folder.path())]),
        Err("NOT_MOUNTED_VOLUME".to_string())
    );
    assert_eq!(
        mounts::ensure_mounted_target_with(folder.path(), Vec::new),
        Err("NOT_MOUNTED_VOLUME".to_string())
    );
    for removable in [false, true] {
        assert!(mounts::ensure_mounted_target_with(folder.path(), || {
            vec![
                root_disk(folder.path()),
                mounted_disk(folder.path(), removable, 100),
            ]
        })
        .is_ok());
    }
}

#[test]
fn mount_containment_requires_a_path_component_boundary() {
    let folder = tempfile::tempdir().unwrap();
    let mount = folder.path().join("usb");
    let target = mount.join("Music");
    let adjacent = folder.path().join("usb-backup");
    std::fs::create_dir_all(&target).unwrap();
    std::fs::create_dir(&adjacent).unwrap();
    assert!(
        mounts::ensure_mounted_target_with(&target, || vec![mounted_disk(&mount, false, 100)])
            .is_ok()
    );
    assert_eq!(
        mounts::ensure_mounted_target_with(&adjacent, || vec![mounted_disk(&mount, false, 100)]),
        Err("NOT_MOUNTED_VOLUME".to_string())
    );
}

#[test]
fn missing_targets_and_mounts_are_not_admitted() {
    let folder = tempfile::tempdir().unwrap();
    let missing = folder.path().join("missing");
    let file = folder.path().join("file");
    std::fs::write(&file, b"x").unwrap();
    for path in [&missing, &file] {
        assert_eq!(
            mounts::ensure_mounted_target_with(path, unexpected_inventory),
            Err("VOLUME_NOT_FOUND".to_string())
        );
    }
    let enumerated = std::cell::Cell::new(false);
    assert!(!mounts::is_path_on_mounted_volume_with(&missing, || {
        enumerated.set(true);
        vec![mounted_disk(folder.path(), false, 100)]
    }));
    // The standalone classifier enumerates before canonicalizing, unlike the
    // directory guard above and the capacity helper.
    assert!(enumerated.get());
    assert_eq!(
        mounts::ensure_mounted_target_with(folder.path(), || vec![mounted_disk(
            &missing, true, 100
        )]),
        Err("NOT_MOUNTED_VOLUME".to_string())
    );
}

#[cfg(windows)]
#[test]
fn removable_windows_drive_roots_are_admitted() {
    let folder = tempfile::tempdir().unwrap();
    let mut disk = root_disk(folder.path());
    assert!(!mounts::is_path_on_mounted_volume_with(
        folder.path(),
        || vec![root_disk(folder.path())]
    ));
    disk.is_removable = true;
    assert!(mounts::ensure_mounted_target_with(folder.path(), || vec![disk]).is_ok());
}

#[cfg(unix)]
#[test]
fn unix_root_is_excluded_even_if_reported_removable() {
    let folder = tempfile::tempdir().unwrap();
    let mut disk = root_disk(folder.path());
    disk.is_removable = true;
    assert!(!mounts::is_path_on_mounted_volume_with(
        folder.path(),
        || vec![disk]
    ));
}

#[cfg(unix)]
#[test]
fn mount_and_target_aliases_are_canonicalized() {
    let folder = tempfile::tempdir().unwrap();
    let mount = folder.path().join("mount");
    let alias = folder.path().join("alias");
    std::fs::create_dir(&mount).unwrap();
    std::os::unix::fs::symlink(&mount, &alias).unwrap();
    assert!(
        mounts::ensure_mounted_target_with(&mount, || vec![mounted_disk(&alias, false, 100)])
            .is_ok()
    );
    assert!(
        mounts::ensure_mounted_target_with(&alias, || vec![mounted_disk(&mount, false, 100)])
            .is_ok()
    );
}

fn track(builder: impl FnOnce(&mut TrackSyncInfo)) -> TrackSyncInfo {
    let mut track = TrackSyncInfo {
        id: "t1".into(),
        url: "http://example/stream".into(),
        suffix: "flac".into(),
        artist: "Artist".into(),
        album_artist: "AlbumArtist".into(),
        album: "Album".into(),
        title: "Title".into(),
        track_number: Some(1),
        disc_number: None,
        duration: Some(180),
        playlist_name: None,
        playlist_id: None,
        playlist_index: None,
        flat_layout: false,
        overwrite: false,
    };
    builder(&mut track);
    track
}

/// Normalize Windows backslashes so assertions can be written with `/`.
/// `build_track_path` only emits `\` as the OS path separator on Windows;
/// any `\` that appears inside a name component is already replaced with
/// `_` by `sanitize_path_component`.
fn norm(path: String) -> String {
    path.replace('\\', "/")
}

mod download;
mod local_target;
mod manifest;
mod paths;
mod playlist;
mod rename;
