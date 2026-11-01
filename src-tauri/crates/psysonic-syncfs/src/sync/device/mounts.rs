use std::path::Path;

/// Borrow the disk fields used by target admission and capacity checks.
pub(super) trait MountEntry {
    fn mount_point(&self) -> &Path;
    fn is_removable(&self) -> bool;
    fn available_space(&self) -> u64;
}

impl MountEntry for sysinfo::Disk {
    fn mount_point(&self) -> &Path {
        sysinfo::Disk::mount_point(self)
    }

    fn is_removable(&self) -> bool {
        sysinfo::Disk::is_removable(self)
    }

    fn available_space(&self) -> u64 {
        sysinfo::Disk::available_space(self)
    }
}

/// Each call supplies its own inventory; production borrows sysinfo's list
/// directly rather than allocating a second list or copying mount paths.
pub(super) trait MountInventory {
    type Entry: MountEntry;

    fn list(&self) -> &[Self::Entry];
}

impl MountInventory for sysinfo::Disks {
    type Entry = sysinfo::Disk;

    fn list(&self) -> &[Self::Entry] {
        sysinfo::Disks::list(self)
    }
}

pub(super) fn system_mounts() -> sysinfo::Disks {
    sysinfo::Disks::new_with_refreshed_list()
}

/// Checks whether `path` sits on top of an active mount point (i.e. not the root
/// filesystem). This prevents accidentally writing to `/media/usb` after the
/// USB drive has been unmounted — at that point the path would fall through to `/`
/// and fill the root partition.
pub fn is_path_on_mounted_volume(path: &Path) -> bool {
    is_path_on_mounted_volume_with(path, system_mounts)
}

pub(super) fn is_path_on_mounted_volume_with<I: MountInventory>(
    path: &Path,
    inventory: impl FnOnce() -> I,
) -> bool {
    let disks = inventory();
    let canonical = match path.canonicalize() {
        Ok(c) => c,
        Err(_) => return false, // path doesn't exist or isn't accessible
    };
    // Find the longest mount-point prefix that matches this path.
    // Exclude the root "/" (or "C:\" on Windows) so we never "match" a fallback.
    let mut best_len: usize = 0;
    for disk in disks.list() {
        let mount_point = disk.mount_point();
        let mp = mount_point.to_string_lossy().to_string();
        // Skip root mount points (Linux "/" and non-removable Windows drive roots like "C:\").
        // Do NOT skip removable Windows drives (e.g. "E:\") — those are valid sync targets.
        let is_windows_root = mp.len() == 3 && mp.ends_with(":\\") && !disk.is_removable();
        if mp == "/" || is_windows_root {
            continue;
        }
        let canonical_mount = match mount_point.canonicalize() {
            Ok(path) => path,
            Err(_) => continue,
        };
        if canonical.starts_with(&canonical_mount) && mp.len() > best_len {
            best_len = mp.len();
        }
    }
    best_len > 0
}

pub(in crate::sync) fn ensure_mounted_target(path: &Path) -> Result<(), String> {
    ensure_mounted_target_with(path, system_mounts)
}

pub(super) fn ensure_mounted_target_with<I: MountInventory>(
    path: &Path,
    inventory: impl FnOnce() -> I,
) -> Result<(), String> {
    if !path.is_dir() {
        return Err("VOLUME_NOT_FOUND".to_string());
    }
    if !is_path_on_mounted_volume_with(path, inventory) && !super::is_marked_local_target(path) {
        return Err("NOT_MOUNTED_VOLUME".to_string());
    }
    Ok(())
}

/// Free space of the volume holding `path`, including the system volume, so
/// local-folder targets get the same capacity check as removable drives.
pub(crate) fn target_available_space(path: &Path) -> Option<u64> {
    target_available_space_with(path, system_mounts)
}

pub(super) fn target_available_space_with<I: MountInventory>(
    path: &Path,
    inventory: impl FnOnce() -> I,
) -> Option<u64> {
    let canonical = path.canonicalize().ok()?;
    let disks = inventory();
    disks
        .list()
        .iter()
        .filter_map(|disk| {
            let mount = disk.mount_point().canonicalize().ok()?;
            canonical
                .starts_with(&mount)
                .then(|| (mount.components().count(), disk.available_space()))
        })
        .max_by_key(|(depth, _)| *depth)
        .map(|(_, available)| available)
}
