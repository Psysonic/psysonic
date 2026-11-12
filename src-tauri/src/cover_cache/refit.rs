//! One-time refit of display tiers written with the old long-edge fit (#1829).
//!
//! Display tiers now fit the short edge (see `encode::resize_tier`). Covers
//! cached before that keep their long-edge tiers until this pass rewrites
//! them from the dir's own largest tier. Nothing is downloaded or deleted, so
//! a cover stays available while its server is offline.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use image::DynamicImage;
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, OwnedMutexGuard, OwnedSemaphorePermit};

use super::cache_state::{state, CoverCacheState};
use super::disk::{tier_exists, tier_version};
use super::encode::rewrite_webp_tier;
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
/// `128.webp` goes last: the scan finds a dir by its old-fit `128.webp`, so a
/// dir whose refit stopped early (failed write, app closed) is found again.
const REFIT_TIERS: [u32; 3] = [512, 256, 128];

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

/// What the refit of one dir did.
#[derive(Debug, Default)]
struct DirRefit {
    /// Files now in the short-edge fit.
    rewritten: Vec<PathBuf>,
    /// A rewrite failed. That file and the ones after it, `128.webp` last,
    /// keep the old fit, so the next scan finds the dir again.
    failed: bool,
}

/// Refits the dir if it still has the old fit. Runs under the dir's flight
/// lock, so this re-check sees what an ensure wrote before it.
fn refit_dir(dir: &Path) -> DirRefit {
    if has_long_edge_display_tiers(dir) {
        refit_display_tiers(dir)
    } else {
        DirRefit::default()
    }
}

/// Rewrites the dir's display tiers below its largest local tier in the
/// short-edge fit, from that tier's pixels, `128.webp` last. Stops at the
/// first failed write, which keeps its old file. The source tier,
/// `2000.webp` and provider files are not touched.
fn refit_display_tiers(dir: &Path) -> DirRefit {
    refit_display_tiers_with(dir, rewrite_webp_tier)
}

fn refit_display_tiers_with(
    dir: &Path,
    mut write: impl FnMut(&DynamicImage, u32, &Path) -> Result<(), String>,
) -> DirRefit {
    let mut refit = DirRefit::default();
    let Some((source_tier, img)) = SOURCE_TIERS.into_iter().find_map(|tier| {
        let img = image::open(tier_exists(dir, tier)?).ok()?;
        Some((tier, img))
    }) else {
        return refit;
    };
    for tier in REFIT_TIERS.into_iter().filter(|tier| *tier < source_tier) {
        let Some(path) = tier_exists(dir, tier) else {
            continue;
        };
        if write(&img, tier, &path).is_err() {
            refit.failed = true;
            break;
        }
        refit.rewritten.push(path);
    }
    refit
}

/// What a pass over the scanned dirs did.
#[derive(Debug)]
struct RefitPass {
    /// Dirs with at least one rewritten tier.
    refit: usize,
    /// Every dir was refit. Otherwise the stamp stays off and the next start
    /// scans again.
    complete: bool,
}

/// A dir's flight lock and backfill CPU permit, held until its writes are done.
type Admission = (OwnedMutexGuard<()>, OwnedSemaphorePermit);

/// Takes the dir's flight lock, then a backfill CPU permit: the order ensure
/// takes them in, so an ensure that holds the flight never waits for a permit
/// this pass holds.
async fn admit_dir(st: &Arc<Mutex<CoverCacheState>>, dir: &Path) -> Option<Admission> {
    let (flight, cpu_sem) = {
        let guard = st.lock().await;
        (
            inflight_dir_flight(&guard.inflight_dirs, dir),
            guard.cpu_sem_for(true),
        )
    };
    let flight = flight.lock_owned().await;
    let permit = cpu_sem.acquire_owned().await.ok()?;
    Some((flight, permit))
}

/// Refits `dirs` one at a time on a blocking thread. The migration barrier is
/// checked again once a dir is admitted: a migration raises its barrier
/// before it waits for free CPU permits, so a dir admitted after that stops
/// here, and a dir admitted before keeps its permit until its writes are
/// done. A failed or crashed dir leaves the pass incomplete.
async fn refit_dirs(
    st: &Arc<Mutex<CoverCacheState>>,
    dirs: Vec<PathBuf>,
    write_allowed: impl Fn() -> bool,
    refit: fn(&Path) -> DirRefit,
    mut notify: impl FnMut(Vec<String>),
) -> RefitPass {
    let mut pass = RefitPass {
        refit: 0,
        complete: true,
    };
    let mut pending = Vec::new();
    for dir in dirs {
        if !write_allowed() {
            pass.complete = false;
            break;
        }
        let Some(admission) = admit_dir(st, &dir).await else {
            pass.complete = false;
            break;
        };
        if !write_allowed() {
            pass.complete = false;
            break;
        }
        let joined = tauri::async_runtime::spawn_blocking(move || {
            let _admission = admission;
            refit(&dir)
        })
        .await;
        let Ok(dir_refit) = joined else {
            pass.complete = false;
            continue;
        };
        if dir_refit.failed {
            pass.complete = false;
        }
        if !dir_refit.rewritten.is_empty() {
            pass.refit += 1;
        }
        // `path|version`, the peek wire format: entries the webview holds for
        // these files switch to the new version, so cells reload them.
        pending.extend(
            dir_refit
                .rewritten
                .iter()
                .map(|p| format!("{}|{}", p.to_string_lossy(), tier_version(p))),
        );
        if pending.len() >= NOTIFY_CHUNK {
            notify(std::mem::take(&mut pending));
        }
    }
    if !pending.is_empty() {
        notify(pending);
    }
    pass
}

/// Runs the refit off the startup path: the scan reads one header per cover
/// dir, seconds on a large cache. The stamp lands only after a complete
/// pass; an interrupted or failed pass runs again on the next start.
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
        let pass = refit_dirs(
            &st,
            dirs,
            || super::ensure_migration_write_allowed(&app).is_ok(),
            refit_dir,
            |paths| {
                let _ = app.emit(
                    "cover:tiers-rewritten",
                    serde_json::json!({ "paths": paths }),
                );
            },
        )
        .await;
        if pass.refit > 0 {
            clear_dir_usage_cache();
            crate::app_eprintln!(
                "[cover] refit {} non-square covers to short-edge display tiers in {} ms",
                pass.refit,
                started.elapsed().as_millis()
            );
        }
        if pass.complete {
            let _ = std::fs::write(&stamp, b"1");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        admit_dir, has_long_edge_display_tiers, long_edge_display_tier_dirs, refit_dir, refit_dirs,
        refit_display_tiers, refit_display_tiers_with, DirRefit,
    };
    use crate::cover_cache::cache_state::CoverCacheState;
    use crate::cover_cache::encode::{encode_webp, rewrite_webp_tier};
    use crate::cover_cache::ensure::inflight_dir_flight;
    use crate::cover_cache::test_support::fresh_tmpdir;
    use image::{DynamicImage, RgbaImage};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::sync::Mutex;

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

    /// A 450×800 cover cached with the old long-edge fit.
    fn old_fit_portrait(root: &Path) -> PathBuf {
        let dir = cover_dir(root, "album", "pl-1");
        write_tier(&dir, 800, 450, 800);
        write_tier(&dir, 512, 288, 512);
        write_tier(&dir, 256, 144, 256);
        write_tier(&dir, 128, 72, 128);
        dir
    }

    fn dims(dir: &Path, tier: u32) -> (u32, u32) {
        image::image_dimensions(dir.join(format!("{tier}.webp"))).unwrap()
    }

    fn sorted(mut dirs: Vec<PathBuf>) -> Vec<PathBuf> {
        dirs.sort();
        dirs
    }

    fn cover_state(root: &Path) -> Arc<Mutex<CoverCacheState>> {
        Arc::new(Mutex::new(
            CoverCacheState::new(root.to_path_buf()).unwrap(),
        ))
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
        let dir = old_fit_portrait(&root);
        for name in ["2000.webp", "512-fanart.webp", "meta.json"] {
            fs::write(dir.join(name), name.as_bytes()).unwrap();
        }
        let source = fs::read(dir.join("800.webp")).unwrap();

        let refit = refit_display_tiers(&dir);

        assert!(!refit.failed);
        assert_eq!(
            sorted(refit.rewritten),
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

        assert_eq!(
            refit_display_tiers(&dir).rewritten,
            vec![dir.join("128.webp")]
        );
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

        let refit = refit_display_tiers(&dir);
        assert!(refit.rewritten.is_empty());
        assert!(!refit.failed);
        assert_eq!(fs::read(dir.join("128.webp")).unwrap(), thumb);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_refit_that_stops_early_is_found_again_and_finished_on_the_next_start() {
        // A failed write, or the app closing, after any number of rewrites.
        for done in 0..3 {
            let root = fresh_tmpdir(&format!("short-edge-stop-{done}"));
            let dir = old_fit_portrait(&root);
            let thumb = fs::read(dir.join("128.webp")).unwrap();
            let mut writes = 0;

            let refit = refit_display_tiers_with(&dir, |img, tier, path| {
                if writes == done {
                    return Err("no space left on device".to_string());
                }
                writes += 1;
                rewrite_webp_tier(img, tier, path)
            });

            assert!(refit.failed, "stopped after {done}");
            assert_eq!(refit.rewritten.len(), done);
            assert_eq!(fs::read(dir.join("128.webp")).unwrap(), thumb);
            assert_eq!(long_edge_display_tier_dirs(&root), vec![dir.clone()]);

            let refit = refit_display_tiers(&dir);
            assert!(!refit.failed);
            assert_eq!(dims(&dir, 512), (450, 800));
            assert_eq!(dims(&dir, 256), (256, 455));
            assert_eq!(dims(&dir, 128), (128, 228));
            assert!(long_edge_display_tier_dirs(&root).is_empty());

            let _ = fs::remove_dir_all(&root);
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_failed_or_crashed_dir_keeps_the_pass_incomplete() {
        let root = fresh_tmpdir("short-edge-pass-fail");
        let dir = old_fit_portrait(&root);
        let st = cover_state(&root);
        let failed: fn(&Path) -> DirRefit = |_| DirRefit {
            rewritten: Vec::new(),
            failed: true,
        };
        let crashed: fn(&Path) -> DirRefit = |_| panic!("refit worker crashed");

        for refit in [failed, crashed] {
            let pass = refit_dirs(&st, vec![dir.clone()], || true, refit, |_| {}).await;
            assert!(!pass.complete);
        }

        let mut notified = Vec::new();
        let pass = refit_dirs(
            &st,
            vec![dir.clone()],
            || true,
            refit_dir,
            |paths| notified.extend(paths),
        )
        .await;
        assert!(pass.complete);
        assert_eq!(pass.refit, 1);
        assert_eq!(notified.len(), 3);

        let _ = fs::remove_dir_all(&root);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn refit_checks_the_migration_barrier_again_once_admitted() {
        let root = fresh_tmpdir("short-edge-barrier");
        let dir = old_fit_portrait(&root);
        let thumb = fs::read(dir.join("128.webp")).unwrap();
        let st = cover_state(&root);
        // Writers at work hold every backfill permit; the pass waits for one.
        let sem = st.lock().await.cpu_sem_for(true);
        let busy = sem
            .clone()
            .acquire_many_owned(sem.available_permits() as u32)
            .await
            .unwrap();
        let barrier = Arc::new(AtomicBool::new(false));
        let checks = Arc::new(AtomicUsize::new(0));
        let pass = tokio::spawn({
            let (st, dir) = (st.clone(), dir.clone());
            let (barrier, checks) = (barrier.clone(), checks.clone());
            async move {
                // Counted after the read, so the first check is decided
                // before the test raises the barrier.
                let write_allowed = || {
                    let allowed = !barrier.load(Ordering::SeqCst);
                    checks.fetch_add(1, Ordering::SeqCst);
                    allowed
                };
                refit_dirs(&st, vec![dir], write_allowed, refit_dir, |_| {}).await
            }
        });
        while checks.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }

        // A migration raises its barrier, then sees every permit free.
        barrier.store(true, Ordering::SeqCst);
        drop(busy);

        let pass = pass.await.unwrap();
        assert!(!pass.complete);
        assert_eq!(pass.refit, 0);
        assert_eq!(fs::read(dir.join("128.webp")).unwrap(), thumb);

        let _ = fs::remove_dir_all(&root);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn refit_never_holds_a_cpu_permit_an_ensure_with_the_flight_waits_for() {
        let root = fresh_tmpdir("short-edge-lock-order");
        let dir = old_fit_portrait(&root);
        let st = cover_state(&root);
        let (flight, sem) = {
            let guard = st.lock().await;
            (
                inflight_dir_flight(&guard.inflight_dirs, &dir),
                guard.cpu_sem_for(true),
            )
        };
        // One backfill permit left, as with backfill parallelism 1.
        let others = sem
            .clone()
            .acquire_many_owned(sem.available_permits() as u32 - 1)
            .await
            .unwrap();
        // An ensure for this dir holds its flight ...
        let ensure_flight = flight.lock_owned().await;
        let refit = tokio::spawn({
            let (st, dir) = (st.clone(), dir.clone());
            async move { admit_dir(&st, &dir).await.is_some() }
        });
        tokio::time::sleep(Duration::from_millis(50)).await;

        // ... and then needs the last permit.
        let permit = tokio::time::timeout(Duration::from_secs(2), sem.clone().acquire_owned())
            .await
            .expect("the ensure waits for a permit the refit holds")
            .unwrap();
        drop(permit);
        drop(ensure_flight);
        assert!(refit.await.unwrap());

        drop(others);
        let _ = fs::remove_dir_all(&root);
    }
}
