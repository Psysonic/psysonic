use std::path::{Path, PathBuf};

use super::external_ensure::ALBUM_EXT_HIT_MARKER;

const COVER_CACHE_LAYOUT_STAMP: &str = psysonic_core::cover_cache_layout::LAYOUT_STAMP;

/// Drop legacy profile-uuid directories when switching to host index keys (no migration).
pub(super) fn reset_cover_cache_for_index_key_layout(root: &Path) -> Result<(), String> {
    let stamp = root.join(".storage-layout");
    if stamp.is_file() {
        if let Ok(s) = std::fs::read_to_string(&stamp) {
            if s.trim() == COVER_CACHE_LAYOUT_STAMP {
                return Ok(());
            }
        }
    }
    if root.exists() {
        for entry in std::fs::read_dir(root)
            .map_err(|e| e.to_string())?
            .flatten()
        {
            let path = entry.path();
            if path.file_name().and_then(|n| n.to_str()) == Some(".storage-layout") {
                continue;
            }
            if path.is_dir() {
                let _ = std::fs::remove_dir_all(&path);
            } else {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    std::fs::write(&stamp, COVER_CACHE_LAYOUT_STAMP).map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete only external-provider artifacts under a server's cover dir — the
/// `{tier}-{provider}.webp` tiers and `.miss-{provider}` markers — leaving the
/// canonical Navidrome `{tier}.webp` and `.fetch-failed` untouched. Returns the
/// number of files removed.
pub(super) fn purge_external_files(server_dir: &Path) -> usize {
    fn is_external(name: &str) -> bool {
        (name.ends_with(".webp") && name.contains('-')) || name.starts_with(".miss-")
    }
    fn walk(dir: &Path, count: &mut usize) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, count);
            } else if path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(is_external)
                && std::fs::remove_file(&path).is_ok()
            {
                *count += 1;
            }
        }
    }
    let mut count = 0;
    walk(server_dir, &mut count);
    count
}

/// Album cover dirs whose art the external chain wrote in place of the
/// server's (`.album-ext-hit`), across every server bucket
/// (`{root}/{server}/album/{entity}`). With `sources` given, only the dirs
/// whose marker names one of them — plus markers from before the source was
/// recorded, which could have come from either provider.
pub(super) fn external_album_art_dirs(root: &Path, sources: Option<&[String]>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let Ok(servers) = std::fs::read_dir(root) else {
        return dirs;
    };
    for server in servers.flatten() {
        let Ok(albums) = std::fs::read_dir(server.path().join("album")) else {
            continue;
        };
        for album in albums.flatten() {
            let dir = album.path();
            let Ok(marker) = std::fs::read_to_string(dir.join(ALBUM_EXT_HIT_MARKER)) else {
                continue;
            };
            let origin = marker.trim();
            let recorded = matches!(origin, "apple" | "lastfm");
            let selected = match sources {
                None => true,
                Some(list) => !recorded || list.iter().any(|s| s == origin),
            };
            if selected {
                dirs.push(dir);
            }
        }
    }
    dirs
}

/// Remove the album dirs `external_album_art_dirs` selects, so those albums
/// load the server's own art again. Returns how many were removed. Callers
/// with ensures in flight go through the command, which takes each dir's
/// flight lock first.
pub(super) fn purge_external_album_art(root: &Path, sources: Option<&[String]>) -> usize {
    external_album_art_dirs(root, sources)
        .iter()
        .filter(|dir| std::fs::remove_dir_all(dir).is_ok())
        .count()
}

/// One-time cleanup for the album covers the external chain wrote before it
/// could tell a server placeholder from real art: it replaced the art of
/// albums that had their own. Runs once per cache root, before any ensure.
pub(super) fn purge_misattributed_external_album_art_once(root: &Path) -> usize {
    let stamp = root.join(".external-album-art-reset-v1");
    if stamp.is_file() {
        return 0;
    }
    let removed = purge_external_album_art(root, None);
    let _ = std::fs::write(&stamp, b"1");
    removed
}

/// FS-only worker for `cover_cache_rename_server_bucket`.
pub(super) fn rename_bucket_inner(root: &Path, old_key: &str, new_key: &str) -> Result<(), String> {
    if old_key.is_empty() || new_key.is_empty() {
        return Err("cover_cache_rename_server_bucket: empty key".into());
    }
    if !is_safe_index_key(old_key) || !is_safe_index_key(new_key) {
        return Err("cover_cache_rename_server_bucket: key contains path separator".into());
    }
    if old_key == new_key {
        return Ok(());
    }

    let old_dir = root.join(old_key);
    let new_dir = root.join(new_key);

    if !old_dir.is_dir() {
        return Ok(());
    }

    if !new_dir.exists() {
        std::fs::rename(&old_dir, &new_dir).map_err(|e| e.to_string())?;
    } else {
        merge_cover_bucket(&old_dir, &new_dir)?;
        let _ = std::fs::remove_dir_all(&old_dir);
    }
    Ok(())
}

fn is_safe_index_key(key: &str) -> bool {
    // Real index keys are `host[:port][/sub/path]` shape — forward slashes
    // are legitimate path components (Navidrome behind a reverse-proxy
    // subpath, etc.). Everything below is defense-in-depth at the FS boundary.
    if key.is_empty() {
        return false;
    }
    if key.starts_with('/') || key.starts_with('\\') {
        return false;
    }
    let bytes = key.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        return false;
    }
    if key.contains('\\') {
        return false;
    }
    for segment in key.split('/') {
        if segment == ".." {
            return false;
        }
    }
    true
}

pub(super) fn merge_cover_bucket(old_dir: &Path, new_dir: &Path) -> Result<(), String> {
    let entries = std::fs::read_dir(old_dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = new_dir.join(entry.file_name());
        if from.is_dir() {
            if to.is_file() {
                continue;
            }
            std::fs::create_dir_all(&to).map_err(|e| e.to_string())?;
            merge_cover_bucket(&from, &to)?;
        } else if !to.exists() {
            std::fs::rename(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        external_album_art_dirs, is_safe_index_key, merge_cover_bucket, purge_external_album_art,
        purge_external_files, purge_misattributed_external_album_art_once, rename_bucket_inner,
    };
    use crate::cover_cache::test_support::fresh_tmpdir;
    use std::fs;
    use std::path::{Path, PathBuf};

    /// `{root}/{server}/album/{id}` with a `128.webp`, and the chain marker
    /// holding `marker` when given.
    fn album_dir(root: &Path, server: &str, id: &str, marker: Option<&str>) -> PathBuf {
        let dir = root.join(server).join("album").join(id);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("128.webp"), b"art").unwrap();
        if let Some(m) = marker {
            fs::write(dir.join(".album-ext-hit"), m).unwrap();
        }
        dir
    }

    fn sorted(mut dirs: Vec<PathBuf>) -> Vec<PathBuf> {
        dirs.sort();
        dirs
    }

    #[test]
    fn external_album_art_selects_by_recorded_source() {
        let root = fresh_tmpdir("ext-album-select");
        let apple = album_dir(&root, "srv-a", "al-1", Some("apple"));
        let lastfm = album_dir(&root, "srv-a", "al-2", Some("lastfm"));
        let legacy = album_dir(&root, "srv-b", "al-3", Some("1"));
        let _server_art = album_dir(&root, "srv-b", "al-4", None);
        let _artist = {
            let dir = root.join("srv-a").join("artist").join("ar-1");
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join(".album-ext-hit"), b"apple").unwrap();
            dir
        };

        assert_eq!(
            sorted(external_album_art_dirs(&root, None)),
            sorted(vec![apple.clone(), lastfm.clone(), legacy.clone()])
        );
        // Switching Apple Music off takes its own covers and the unrecorded
        // ones, never Last.fm's.
        assert_eq!(
            sorted(external_album_art_dirs(&root, Some(&["apple".to_string()]))),
            sorted(vec![apple, legacy.clone()])
        );
        assert_eq!(
            sorted(external_album_art_dirs(
                &root,
                Some(&["lastfm".to_string()])
            )),
            sorted(vec![lastfm, legacy])
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn purge_external_album_art_leaves_server_art() {
        let root = fresh_tmpdir("ext-album-purge");
        let apple = album_dir(&root, "srv", "al-1", Some("apple"));
        let lastfm = album_dir(&root, "srv", "al-2", Some("lastfm"));
        let server_art = album_dir(&root, "srv", "al-3", None);

        assert_eq!(
            purge_external_album_art(&root, Some(&["apple".to_string()])),
            1
        );
        assert!(!apple.exists());
        assert!(lastfm.join("128.webp").exists());
        assert!(server_art.join("128.webp").exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn misattributed_external_album_art_is_purged_once() {
        let root = fresh_tmpdir("ext-album-once");
        let first = album_dir(&root, "srv", "al-1", Some("1"));
        let server_art = album_dir(&root, "srv", "al-2", None);

        assert_eq!(purge_misattributed_external_album_art_once(&root), 1);
        assert!(!first.exists());
        assert!(server_art.join("128.webp").exists());

        // A cover the fixed chain resolves later survives restarts.
        let later = album_dir(&root, "srv", "al-5", Some("apple"));
        assert_eq!(purge_misattributed_external_album_art_once(&root), 0);
        assert!(later.join("128.webp").exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn safe_index_key_accepts_real_keys() {
        assert!(is_safe_index_key("music.example.com"));
        assert!(is_safe_index_key("192.168.0.10:4533"));
        assert!(is_safe_index_key("music.example.com/navidrome"));
        assert!(is_safe_index_key("[fe80::1]:4533"));
    }

    #[test]
    fn safe_index_key_rejects_path_traversal_and_backslashes() {
        assert!(!is_safe_index_key("../etc"));
        assert!(!is_safe_index_key("a/../b"));
        assert!(!is_safe_index_key("a\\b"));
        assert!(!is_safe_index_key("..\\evil"));
    }

    #[test]
    fn safe_index_key_rejects_absolute_paths_and_drive_letters() {
        assert!(!is_safe_index_key("/etc/passwd"));
        assert!(!is_safe_index_key("/"));
        assert!(!is_safe_index_key("\\windows"));
        assert!(!is_safe_index_key("C:"));
        assert!(!is_safe_index_key("C:/Windows"));
        assert!(!is_safe_index_key("c:foo"));
        assert!(!is_safe_index_key(""));
    }

    #[test]
    fn merge_bucket_moves_unique_files() {
        let root = fresh_tmpdir("merge-unique");
        let old = root.join("old");
        let new = root.join("new");
        fs::create_dir_all(old.join("al-1")).unwrap();
        fs::write(old.join("al-1").join("128.webp"), b"old-bytes").unwrap();
        fs::create_dir_all(&new).unwrap();

        merge_cover_bucket(&old, &new).unwrap();

        assert!(new.join("al-1").join("128.webp").exists());
        assert_eq!(
            fs::read(new.join("al-1").join("128.webp")).unwrap(),
            b"old-bytes"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn merge_bucket_prefers_existing_on_collision() {
        let root = fresh_tmpdir("merge-collision");
        let old = root.join("old");
        let new = root.join("new");
        fs::create_dir_all(old.join("al-1")).unwrap();
        fs::create_dir_all(new.join("al-1")).unwrap();
        fs::write(old.join("al-1").join("128.webp"), b"OLD").unwrap();
        fs::write(new.join("al-1").join("128.webp"), b"NEW").unwrap();

        merge_cover_bucket(&old, &new).unwrap();

        assert_eq!(fs::read(new.join("al-1").join("128.webp")).unwrap(), b"NEW");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rename_bucket_inner_rejects_empty_keys() {
        let root = fresh_tmpdir("rename-empty");
        assert!(rename_bucket_inner(&root, "", "new").is_err());
        assert!(rename_bucket_inner(&root, "old", "").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rename_bucket_inner_rejects_unsafe_keys() {
        let root = fresh_tmpdir("rename-unsafe");
        assert!(rename_bucket_inner(&root, "../escape", "new").is_err());
        assert!(rename_bucket_inner(&root, "old", "/abs/path").is_err());
        assert!(rename_bucket_inner(&root, "old", "C:/Windows").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rename_bucket_inner_noop_when_old_missing() {
        let root = fresh_tmpdir("rename-missing");
        rename_bucket_inner(&root, "old", "new").unwrap();
        assert!(!root.join("new").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rename_bucket_inner_noop_when_keys_equal() {
        let root = fresh_tmpdir("rename-equal");
        fs::create_dir_all(root.join("same").join("al-1")).unwrap();
        fs::write(root.join("same").join("al-1").join("128.webp"), b"x").unwrap();
        rename_bucket_inner(&root, "same", "same").unwrap();
        assert!(root.join("same").join("al-1").join("128.webp").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rename_bucket_inner_simple_rename_when_new_missing() {
        let root = fresh_tmpdir("rename-simple");
        fs::create_dir_all(root.join("old").join("al-1")).unwrap();
        fs::write(root.join("old").join("al-1").join("128.webp"), b"payload").unwrap();
        rename_bucket_inner(&root, "old", "new").unwrap();
        assert!(!root.join("old").exists());
        assert_eq!(
            fs::read(root.join("new").join("al-1").join("128.webp")).unwrap(),
            b"payload",
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rename_bucket_inner_merges_when_new_exists() {
        let root = fresh_tmpdir("rename-merge");
        fs::create_dir_all(root.join("old").join("al-1")).unwrap();
        fs::create_dir_all(root.join("new").join("al-2")).unwrap();
        fs::write(root.join("old").join("al-1").join("128.webp"), b"from-old").unwrap();
        fs::write(root.join("new").join("al-2").join("128.webp"), b"from-new").unwrap();
        fs::create_dir_all(root.join("old").join("al-2")).unwrap();
        fs::write(
            root.join("old").join("al-2").join("128.webp"),
            b"overwrite-attempt",
        )
        .unwrap();

        rename_bucket_inner(&root, "old", "new").unwrap();

        assert!(!root.join("old").exists());
        assert_eq!(
            fs::read(root.join("new").join("al-1").join("128.webp")).unwrap(),
            b"from-old",
        );
        assert_eq!(
            fs::read(root.join("new").join("al-2").join("128.webp")).unwrap(),
            b"from-new",
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn purge_external_removes_only_external_artifacts() {
        let root = fresh_tmpdir("purge-external");
        let entity = root.join("artist").join("ar-1");
        fs::create_dir_all(&entity).unwrap();
        fs::write(entity.join("2000.webp"), b"n").unwrap();
        fs::write(entity.join("512.webp"), b"n").unwrap();
        fs::write(entity.join(".fetch-failed"), b"1").unwrap();
        fs::write(entity.join("2000-fanart.webp"), b"f").unwrap();
        fs::write(entity.join("512-fanart.webp"), b"f").unwrap();
        fs::write(entity.join("2000-banner.webp"), b"b").unwrap();
        fs::write(entity.join(".miss-fanart"), b"1").unwrap();
        fs::write(entity.join(".miss-banner"), b"1").unwrap();

        assert_eq!(purge_external_files(&root), 5);

        assert!(entity.join("2000.webp").exists());
        assert!(entity.join("512.webp").exists());
        assert!(entity.join(".fetch-failed").exists());
        assert!(!entity.join("2000-fanart.webp").exists());
        assert!(!entity.join("512-fanart.webp").exists());
        assert!(!entity.join("2000-banner.webp").exists());
        assert!(!entity.join(".miss-fanart").exists());
        assert!(!entity.join(".miss-banner").exists());
        let _ = fs::remove_dir_all(&root);
    }
}
