use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

pub use psysonic_core::cover_cache_layout;

pub const DERIVE_TIERS: [u32; 4] = [128, 256, 512, 800];

/// Delegates to [`cover_cache_layout::cover_dir`] — disk path format lives in `psysonic-core`.
pub fn cover_dir(
    root: &Path,
    server_index_key: &str,
    cache_kind: &str,
    cache_entity_id: &str,
) -> PathBuf {
    cover_cache_layout::cover_dir(root, server_index_key, cache_kind, cache_entity_id)
}

pub fn tier_path(dir: &Path, tier: u32) -> PathBuf {
    dir.join(format!("{tier}.webp"))
}

/// External-provider tier file in the SAME entity dir, differentiated by a
/// filename suffix only (image-scraper §14/§16): `{tier}-{provider}.webp`
/// (e.g. `2000-fanart.webp`). The `coverStorageKey`/`cacheKind` is unchanged.
pub fn provider_tier_path(dir: &Path, tier: u32, provider: &str) -> PathBuf {
    dir.join(format!("{tier}-{provider}.webp"))
}

pub fn provider_tier_exists(dir: &Path, tier: u32, provider: &str) -> Option<PathBuf> {
    let p = provider_tier_path(dir, tier, provider);
    if p.is_file() {
        Some(p)
    } else {
        None
    }
}

#[allow(dead_code)]
pub fn meta_path(dir: &Path) -> PathBuf {
    dir.join("meta.json")
}

pub fn tier_exists(dir: &Path, tier: u32) -> Option<PathBuf> {
    let p = tier_path(dir, tier);
    if p.is_file() {
        Some(p)
    } else {
        None
    }
}

/// Version stamp for a tier file: mtime in epoch seconds, `0` when the file is
/// unreadable. The webview appends it to the asset URL (`?v=`) so a tier that
/// was overwritten IN PLACE (chain art replacing backfill vinyl) gets a fresh
/// URL — otherwise the webview image cache keeps serving the old bytes for the
/// unchanged path, which was the observed queue/playbar vinyl flash.
pub(super) fn tier_version(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Write missing WebP tiers up to `max_tier` (used by library bulk backfill).
pub fn write_derived_webp_tiers(
    dir: &Path,
    img: &image::DynamicImage,
    max_tier: u32,
) -> Result<(), String> {
    use super::encode::write_webp_tier;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    for &tier in DERIVE_TIERS.iter() {
        if tier > max_tier {
            continue;
        }
        if tier_exists(dir, tier).is_some() {
            continue;
        }
        write_webp_tier(img, tier, &tier_path(dir, tier))?;
    }
    Ok(())
}

/// Numbers the temp files of [`replace_file`] within this process.
static REPLACE_SEQ: AtomicU64 = AtomicU64::new(0);

/// Replaces `path` with `bytes` without a moment of partial content: the bytes
/// go to a new hidden file next to it, which is then renamed over `path`. A
/// failed write or rename keeps the old file and removes the new one. Asset
/// reads take no flight lock, so they see the old file or the new one. Never
/// creates the dir: a dir moved away meanwhile is not brought back.
pub(super) fn replace_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    replace_file_with(path, |file| file.write_all(bytes))
}

fn replace_file_with(
    path: &Path,
    write: impl FnOnce(&mut std::fs::File) -> std::io::Result<()>,
) -> Result<(), String> {
    let name = path
        .file_name()
        .ok_or_else(|| format!("no file name in {}", path.display()))?;
    let temp = path.with_file_name(format!(
        ".{}.{}-{}.tmp",
        name.to_string_lossy(),
        std::process::id(),
        REPLACE_SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    let result = std::fs::File::options()
        .write(true)
        .create_new(true)
        .open(&temp)
        .and_then(|mut file| write(&mut file))
        .and_then(|()| std::fs::rename(&temp, path));
    result.map_err(|e| {
        let _ = std::fs::remove_file(&temp);
        e.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::{replace_file, replace_file_with};
    use crate::cover_cache::test_support::fresh_tmpdir;
    use std::fs;
    use std::io::Write;
    use std::path::Path;

    fn entries(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn replace_file_swaps_in_the_new_bytes() {
        let dir = fresh_tmpdir("replace-ok");
        let path = dir.join("128.webp");
        fs::write(&path, b"old").unwrap();

        replace_file(&path, b"new bytes").unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"new bytes");
        assert_eq!(entries(&dir), ["128.webp"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_write_that_fails_halfway_keeps_the_old_file() {
        // Disk full after the first bytes: the old tier must survive whole.
        let dir = fresh_tmpdir("replace-fail");
        let path = dir.join("128.webp");
        fs::write(&path, b"old tier").unwrap();

        let result = replace_file_with(&path, |file| {
            file.write_all(b"par")?;
            Err(std::io::Error::other("no space left on device"))
        });

        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"old tier");
        assert_eq!(entries(&dir), ["128.webp"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn replace_file_does_not_bring_back_a_moved_dir() {
        let root = fresh_tmpdir("replace-moved");
        let dir = root.join("al-1");

        assert!(replace_file(&dir.join("128.webp"), b"new").is_err());
        assert!(!dir.exists());
        let _ = fs::remove_dir_all(&root);
    }
}
