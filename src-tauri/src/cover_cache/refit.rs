//! One-time refit of display tiers written with the old long-edge fit (#1829).
//!
//! Display tiers now fit the short edge (see `encode::resize_tier`). Covers
//! cached before that keep their long-edge tiers until this pass rewrites
//! them from the dir's own largest tier. Nothing is downloaded or deleted, so
//! a cover stays available while its server is offline.

use std::path::{Path, PathBuf};
use std::time::Instant;

use tauri::{AppHandle, Emitter};

use super::cache_state::state;
use super::disk::{tier_exists, tier_version};
use super::encode::write_webp_tier;
use super::ensure::inflight_dir_flight;
use super::metrics::clear_dir_usage_cache;

/// Short edge below which a long-edge `128.webp` counts as non-square — a
/// near-square cover looks the same under both fits and keeps its tiers.
const SHORT_EDGE_BELOW: u32 = 121;

/// Written to the cache root once the refit has run to the end.
const SHORT_EDGE_REFIT_STAMP: &str = ".display-tier-short-edge-v1";

/// Local source tiers, largest first. `800.webp` is the server art at the
/// size ensure downloads (`size=800`), so the smaller tiers rewritten from it
/// match what a fresh download would write.
const SOURCE_TIERS: [u32; 3] = [800, 512, 256];

/// Display tiers the pass rewrites, when present and smaller than the source.
const REFIT_TIERS: [u32; 3] = [128, 256, 512];

/// Rewritten files per `cover:tiers-rewritten` event.
const NOTIFY_CHUNK: usize = 64;

/// True when the dir's `128.webp` was written with the old long-edge fit from
/// a non-square cover: long edge at 128, short edge clearly below it. Tiers
/// written now put the SHORT edge at the tier, so they never match.
fn has_long_edge_display_tiers(entity_dir: &Path) -> bool {
    let Ok((w, h)) = image::image_dimensions(entity_dir.join("128.webp")) else {
        return false;
    };
    (127..=128).contains(&w.max(h)) && w.min(h) < SHORT_EDGE_BELOW
}

/// Cover dirs across every server bucket whose display tiers still carry the
/// long-edge fit. Reads one header per dir.
fn long_edge_display_tier_dirs(root: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for server in std::fs::read_dir(root).into_iter().flatten().flatten() {
        for kind in psysonic_core::cover_cache_layout::SEGMENT_KINDS {
            let Ok(entities) = std::fs::read_dir(server.path().join(kind)) else {
                continue;
            };
            for entity in entities.flatten() {
                let dir = entity.path();
                if has_long_edge_display_tiers(&dir) {
                    dirs.push(dir);
                }
            }
        }
    }
    dirs
}

/// Rewrites the dir's display tiers below its largest local tier in the
/// short-edge fit, from that tier's pixels. The source tier, `2000.webp` and
/// provider files stay as they are, and a failed write keeps the old file.
/// Returns the rewritten files.
fn refit_display_tiers(dir: &Path) -> Vec<PathBuf> {
    let Some((source_tier, img)) = SOURCE_TIERS.into_iter().find_map(|tier| {
        let img = image::open(tier_exists(dir, tier)?).ok()?;
        Some((tier, img))
    }) else {
        return Vec::new();
    };
    REFIT_TIERS
        .into_iter()
        .filter(|tier| *tier < source_tier)
        .filter_map(|tier| Some((tier, tier_exists(dir, tier)?)))
        .filter(|(tier, path)| write_webp_tier(&img, *tier, path).is_ok())
        .map(|(_, path)| path)
        .collect()
}

/// Hands rewritten files to the webview as `path|version`, the peek wire
/// format: entries it already holds for them switch to the new version, so a
/// cell that showed a file before its rewrite reloads it.
fn notify_rewritten(app: &AppHandle, pending: &mut Vec<String>) {
    if pending.is_empty() {
        return;
    }
    let _ = app.emit(
        "cover:tiers-rewritten",
        serde_json::json!({ "paths": std::mem::take(pending) }),
    );
}

/// Runs the refit off the startup path: the scan reads one header per cover
/// dir, seconds on a large cache. Each dir is rewritten on a backfill CPU
/// permit, under its flight lock and after a re-check, so no ensure writes it
/// at the same time. The stamp lands only after a full pass; an interrupted
/// pass runs again on the next start.
pub(super) fn spawn_short_edge_refit(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let Ok(st) = state(&app) else {
            return;
        };
        let root = st.lock().await.root.clone();
        let stamp = root.join(SHORT_EDGE_REFIT_STAMP);
        if stamp.is_file() {
            return;
        }
        let started = Instant::now();
        let scan_root = root.clone();
        let Ok(dirs) =
            tauri::async_runtime::spawn_blocking(move || long_edge_display_tier_dirs(&scan_root))
                .await
        else {
            return;
        };
        let mut refit = 0usize;
        let mut pending = Vec::new();
        let mut complete = true;
        for dir in dirs {
            if super::ensure_migration_write_allowed(&app).is_err() {
                complete = false;
                break;
            }
            let (flight, cpu_sem) = {
                let guard = st.lock().await;
                (
                    inflight_dir_flight(&guard.inflight_dirs, &dir),
                    guard.cpu_sem_for(true),
                )
            };
            let Ok(cpu_permit) = cpu_sem.acquire_owned().await else {
                complete = false;
                break;
            };
            let _flight = flight.lock().await;
            let rewritten = tauri::async_runtime::spawn_blocking(move || {
                let _cpu_permit = cpu_permit;
                if has_long_edge_display_tiers(&dir) {
                    refit_display_tiers(&dir)
                } else {
                    Vec::new()
                }
            })
            .await
            .unwrap_or_default();
            if !rewritten.is_empty() {
                refit += 1;
            }
            pending.extend(
                rewritten
                    .iter()
                    .map(|p| format!("{}|{}", p.to_string_lossy(), tier_version(p))),
            );
            if pending.len() >= NOTIFY_CHUNK {
                notify_rewritten(&app, &mut pending);
            }
        }
        notify_rewritten(&app, &mut pending);
        if refit > 0 {
            clear_dir_usage_cache();
            crate::app_eprintln!(
                "[cover] refit {refit} non-square covers to short-edge display tiers in {} ms",
                started.elapsed().as_millis()
            );
        }
        if complete {
            let _ = std::fs::write(&stamp, b"1");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{has_long_edge_display_tiers, long_edge_display_tier_dirs, refit_display_tiers};
    use crate::cover_cache::encode::encode_webp;
    use crate::cover_cache::test_support::fresh_tmpdir;
    use image::{DynamicImage, RgbaImage};
    use std::fs;
    use std::path::{Path, PathBuf};

    /// `{root}/srv/{kind}/{id}`, created empty.
    fn cover_dir(root: &Path, kind: &str, id: &str) -> PathBuf {
        let dir = root.join("srv").join(kind).join(id);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A real `{tier}.webp` of `w`×`h` px.
    fn write_tier(dir: &Path, tier: u32, w: u32, h: u32) {
        let img = DynamicImage::ImageRgba8(RgbaImage::new(w, h));
        fs::write(
            dir.join(format!("{tier}.webp")),
            encode_webp(&img, tier).unwrap(),
        )
        .unwrap();
    }

    fn dims(dir: &Path, tier: u32) -> (u32, u32) {
        image::image_dimensions(dir.join(format!("{tier}.webp"))).unwrap()
    }

    fn sorted(mut dirs: Vec<PathBuf>) -> Vec<PathBuf> {
        dirs.sort();
        dirs
    }

    #[test]
    fn refit_scan_finds_only_long_edge_tiers_of_non_square_covers() {
        let root = fresh_tmpdir("short-edge-scan");
        let portrait = cover_dir(&root, "album", "pl-1");
        write_tier(&portrait, 128, 72, 128);
        let artist = cover_dir(&root, "artist", "ar-1");
        write_tier(&artist, 128, 128, 85);
        let chain_art = cover_dir(&root, "album", "al-3");
        write_tier(&chain_art, 128, 72, 128);
        fs::write(chain_art.join(".album-ext-hit"), b"apple").unwrap();
        for (id, w, h) in [("al-1", 128, 128), ("al-2", 124, 128), ("pl-2", 128, 228)] {
            write_tier(&cover_dir(&root, "album", id), 128, w, h);
        }
        fs::write(root.join(".storage-layout"), b"stamp").unwrap();

        assert_eq!(
            sorted(long_edge_display_tier_dirs(&root)),
            sorted(vec![portrait, artist, chain_art])
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn refit_rewrites_smaller_tiers_from_the_800_tier_and_keeps_the_rest() {
        let root = fresh_tmpdir("short-edge-refit");
        let dir = cover_dir(&root, "album", "pl-1");
        write_tier(&dir, 800, 450, 800);
        write_tier(&dir, 512, 288, 512);
        write_tier(&dir, 256, 144, 256);
        write_tier(&dir, 128, 72, 128);
        for name in ["2000.webp", "512-fanart.webp", "meta.json"] {
            fs::write(dir.join(name), name.as_bytes()).unwrap();
        }
        let source = fs::read(dir.join("800.webp")).unwrap();

        let rewritten = refit_display_tiers(&dir);

        assert_eq!(
            sorted(rewritten),
            sorted(
                [128, 256, 512]
                    .map(|t| dir.join(format!("{t}.webp")))
                    .to_vec()
            )
        );
        assert_eq!(dims(&dir, 128), (128, 228));
        assert_eq!(dims(&dir, 256), (256, 455));
        assert_eq!(dims(&dir, 512), (450, 800));
        assert_eq!(fs::read(dir.join("800.webp")).unwrap(), source);
        for name in ["2000.webp", "512-fanart.webp", "meta.json"] {
            assert_eq!(fs::read(dir.join(name)).unwrap(), name.as_bytes());
        }
        assert!(!has_long_edge_display_tiers(&dir));
        assert!(long_edge_display_tier_dirs(&root).is_empty());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn refit_falls_back_to_the_largest_tier_on_disk() {
        let root = fresh_tmpdir("short-edge-refit-512");
        let dir = cover_dir(&root, "album", "pl-1");
        write_tier(&dir, 512, 288, 512);
        write_tier(&dir, 128, 72, 128);
        let source = fs::read(dir.join("512.webp")).unwrap();

        assert_eq!(refit_display_tiers(&dir), vec![dir.join("128.webp")]);
        assert_eq!(dims(&dir, 128), (128, 228));
        assert_eq!(fs::read(dir.join("512.webp")).unwrap(), source);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn refit_leaves_a_dir_without_a_larger_tier_untouched() {
        let root = fresh_tmpdir("short-edge-refit-none");
        let dir = cover_dir(&root, "album", "pl-1");
        write_tier(&dir, 128, 72, 128);
        let thumb = fs::read(dir.join("128.webp")).unwrap();

        assert!(refit_display_tiers(&dir).is_empty());
        assert_eq!(fs::read(dir.join("128.webp")).unwrap(), thumb);

        let _ = fs::remove_dir_all(&root);
    }
}
