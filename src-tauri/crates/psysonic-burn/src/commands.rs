//! Tauri command surface for the CD burner.
//!
//! `burn_start` returns as soon as the job is registered; everything after
//! that arrives on `burn:progress` / `burn:complete`, the same shape the
//! device-sync job uses.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::fetch;
use crate::job;
use crate::model::{
    BurnMediaInfo, BurnOptions, BurnPhase, BurnPlan, BurnRecorder, BurnResult, BurnTrackInput,
    CdTextVerification,
};
use crate::plan::plan_disc;
use crate::platform;
use crate::render::{self, RenderedTrack};
use psysonic_core::server_http::ServerHttpRegistry;

/// Loudness every track is brought to when normalisation is on.
///
/// -14 LUFS is the streaming-era convention: loud enough that a quiet
/// remaster is not buried, quiet enough that a modern master needs little
/// gain reduction and keeps its headroom.
const NORMALIZE_TARGET_LUFS: f64 = -14.0;

// ── Read-only queries ────────────────────────────────────────────────────────

/// Optical recorders attached to this machine.
///
/// Returns an empty list (not an error) on platforms without a backend, so
/// the UI can explain itself with `burn_is_supported`.
#[tauri::command]
#[specta::specta]
pub fn burn_list_recorders() -> Result<Vec<BurnRecorder>, String> {
    platform::list_recorders()
}

/// Whether this platform has a burn backend at all.
#[tauri::command]
#[specta::specta]
pub fn burn_is_supported() -> bool {
    platform::is_supported()
}

/// What is in the drive right now: media type, blankness, capacity, speeds.
#[tauri::command]
#[specta::specta]
pub fn burn_probe_media(recorder_id: String) -> Result<BurnMediaInfo, String> {
    platform::probe_media(&recorder_id)
}

/// Lay the running order out on a disc of `capacity_sectors`.
///
/// Pure arithmetic from the library's durations — instant, so the UI can call
/// it on every reorder. The authoritative sector counts only exist after
/// rendering, and `burn_start` re-checks against the real disc before writing.
#[tauri::command]
#[specta::specta]
pub fn burn_plan(tracks: Vec<BurnTrackInput>, capacity_sectors: u32) -> Result<BurnPlan, String> {
    Ok(plan_disc(&tracks, capacity_sectors, None))
}

/// Stop a running job at its next checkpoint.
///
/// Returns `false` when the job already finished. Cancelling mid-write cannot
/// un-burn committed sectors — the disc is spoiled either way.
#[tauri::command]
#[specta::specta]
pub fn burn_cancel(job_id: String) -> bool {
    job::request_cancel(&job_id)
}

/// Read CD-TEXT back off the disc that is loaded right now.
///
/// Separate from the burn because a drive often caches the table of contents it
/// read when the disc was inserted; checking straight after a burn can miss a
/// lead-in that is genuinely there. Reloading the disc and running this is what
/// settles it.
#[tauri::command]
#[specta::specta]
pub async fn burn_verify_cd_text(recorder_id: String) -> Result<CdTextVerification, String> {
    tauri::async_runtime::spawn_blocking(move || platform::verify_cd_text(&recorder_id))
        .await
        .map_err(|e| format!("verification task failed: {e}"))?
}

/// Erase a CD-RW. `quick` clears the TOC; a full erase rewrites the surface
/// and takes much longer.
#[tauri::command]
#[specta::specta]
pub async fn burn_erase(recorder_id: String, quick: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || platform::erase(&recorder_id, quick))
        .await
        .map_err(|e| format!("erase task failed: {e}"))?
}

// ── The burn job ─────────────────────────────────────────────────────────────

/// Render `tracks` to Red Book PCM and write them to the disc.
///
/// Returns once the job is registered. Watch `burn:progress` and
/// `burn:complete` for the rest.
#[tauri::command]
#[specta::specta]
pub fn burn_start(
    app: AppHandle,
    job_id: String,
    tracks: Vec<BurnTrackInput>,
    options: BurnOptions,
) -> Result<(), String> {
    if tracks.is_empty() {
        return Err("Add at least one track before burning.".to_string());
    }
    if options.recorder_id.trim().is_empty() {
        return Err("Choose a drive before burning.".to_string());
    }
    if let Some(track) = tracks
        .iter()
        .find(|t| !fetch::has_local_source(t) && t.download_url.is_none())
    {
        return Err(format!(
            "“{}” is not downloaded and has no download address.",
            track.title
        ));
    }

    let cancel = job::register_job(&job_id);
    let workdir = burn_workdir(&app, &job_id)?;

    std::thread::Builder::new()
        .name("psysonic-burn-job".into())
        .spawn(move || {
            let outcome = run_job(&app, &job_id, &workdir, tracks, &options, &cancel);
            // Rendered PCM is large (up to ~846 MB for a full disc) and useless
            // once the burn is over, so clear it whatever happened.
            let _ = std::fs::remove_dir_all(&workdir);
            job::unregister_job(&job_id);

            let result = match outcome {
                Ok(written) => BurnResult {
                    job_id: job_id.clone(),
                    cancelled: false,
                    tracks_written: written.tracks,
                    sectors_written: written.sectors,
                    error: None,
                    test_write: options.test_write,
                    cd_text_written: written.cd_text_written,
                    cd_text_verification: written.cd_text_verification.clone(),
                },
                Err(error) => {
                    let cancelled = cancel.load(Ordering::Relaxed) || error == "cancelled";
                    BurnResult {
                        job_id: job_id.clone(),
                        cancelled,
                        tracks_written: 0,
                        sectors_written: 0,
                        error: if cancelled { None } else { Some(error) },
                        test_write: options.test_write,
                        cd_text_written: false,
                        cd_text_verification: None,
                    }
                }
            };
            job::emit_complete(&app, &result);
        })
        .map_err(|e| format!("could not start the burn job: {e}"))?;

    Ok(())
}

struct JobOutcome {
    tracks: u32,
    sectors: u32,
    cd_text_written: bool,
    cd_text_verification: Option<CdTextVerification>,
}

/// Where rendered PCM lives for the duration of one job.
fn burn_workdir(app: &AppHandle, job_id: &str) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("no cache directory available: {e}"))?;
    let dir = base.join("burn").join(sanitize_job_id(job_id));
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create the render folder {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Job ids come from the frontend, so they never reach the filesystem raw.
fn sanitize_job_id(job_id: &str) -> String {
    let cleaned: String = job_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect();
    if cleaned.is_empty() {
        "job".to_string()
    } else {
        cleaned
    }
}

fn run_job(
    app: &AppHandle,
    job_id: &str,
    workdir: &std::path::Path,
    tracks: Vec<BurnTrackInput>,
    options: &BurnOptions,
    cancel: &Arc<AtomicBool>,
) -> Result<JobOutcome, String> {
    let total = tracks.len() as u32;

    // ── Pre-flight: will this even fit on disk? ──────────────────────────
    // Cheaper to refuse now than to fail after downloading 800 MB.
    fetch::check_free_space(workdir, fetch::estimated_peak_bytes(&tracks))?;

    let plan = fetch::plan_fetch(&tracks);
    let http = if plan.is_empty() {
        None
    } else {
        // Only build a client (and touch the runtime) when something actually
        // needs downloading.
        Some(fetch::fetch_client()?)
    };
    let registry = app
        .try_state::<Arc<ServerHttpRegistry>>()
        .map(|state| Arc::clone(&*state));

    let mut rendered: Vec<RenderedTrack> = Vec::with_capacity(tracks.len());

    // One pass per track: fetch → measure → render → drop the source.
    //
    // Doing it per track rather than in phase-wide sweeps keeps peak disk to a
    // single source file plus the accumulating PCM. Normalisation gain is
    // computed against a fixed target, not against the other tracks, so no
    // track needs to know about any other and nothing forces a global pass.
    for (index, track) in tracks.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".to_string());
        }

        // ── Fetch, when the offline cache does not already have it ───────
        let (source_path, fetched) = if fetch::has_local_source(track) {
            (
                PathBuf::from(track.source_path.clone().unwrap_or_default()),
                false,
            )
        } else {
            job::emit_progress(
                app,
                job_id,
                BurnPhase::Fetching,
                Some(index),
                index as u32,
                total,
                None,
            );
            let client = http
                .as_ref()
                .ok_or_else(|| "internal error: fetch client missing".to_string())?;
            let path = tauri::async_runtime::block_on(fetch::fetch_track(
                track,
                index,
                workdir,
                client,
                registry.as_deref(),
                cancel,
            ))?;
            (path, true)
        };

        // ── Optional loudness measurement ────────────────────────────────
        let mut gain = 1.0_f32;
        if options.normalize {
            if cancel.load(Ordering::Relaxed) {
                return Err("cancelled".to_string());
            }
            job::emit_progress(
                app,
                job_id,
                BurnPhase::Analyzing,
                Some(index),
                index as u32,
                total,
                None,
            );
            // A track we cannot measure stays at unity rather than failing the
            // whole disc.
            if let Ok(loudness) = render::measure_loudness(&source_path, cancel) {
                gain = render::normalization_gain(
                    loudness.lufs,
                    loudness.peak,
                    NORMALIZE_TARGET_LUFS,
                );
            }
        }

        // ── Render to Red Book PCM ───────────────────────────────────────
        job::emit_progress(
            app,
            job_id,
            BurnPhase::Rendering,
            Some(index),
            index as u32,
            total,
            None,
        );

        let dest = workdir.join(format!("{:02}.pcm", index + 1));
        let result = render::render_track(&source_path, &dest, gain, cancel);

        // The source has served its purpose either way; a fetched copy is dead
        // weight from here on, and holding them all would double peak disk.
        if fetched {
            let _ = std::fs::remove_file(&source_path);
        }

        let mut track_out =
            result.map_err(|e| format!("“{}” could not be prepared: {e}", track.title))?;
        track_out.isrc = track.isrc.clone();
        track_out.title = track.title.clone();
        track_out.artist = track.artist.clone();
        rendered.push(track_out);
    }

    // ── Re-check capacity against what actually rendered ─────────────────
    let hints: Vec<u32> = rendered.iter().map(|t| t.sectors).collect();
    let media = platform::probe_media(&options.recorder_id)?;
    let plan = plan_disc(&tracks, media.capacity_sectors, Some(&hints));
    if !plan.fits {
        return Err(plan
            .warnings
            .first()
            .cloned()
            .unwrap_or_else(|| "The running order does not fit this disc.".to_string()));
    }
    if let Some(blocker) = media.blocker {
        return Err(blocker);
    }

    let track_count = rendered.len() as u32;
    let outcome = platform::burn(
        app.clone(),
        job_id.to_string(),
        rendered,
        options.clone(),
        Arc::clone(cancel),
    )?;

    Ok(JobOutcome {
        tracks: track_count,
        sectors: outcome.sectors,
        cd_text_written: outcome.cd_text_written,
        cd_text_verification: outcome.cd_text_verification,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_ids_are_stripped_to_safe_path_segments() {
        assert_eq!(sanitize_job_id("burn-123_ok"), "burn-123_ok");
        assert_eq!(sanitize_job_id("../../etc/passwd"), "etcpasswd");
        assert_eq!(sanitize_job_id("a/b\\c:d"), "abcd");
    }

    #[test]
    fn an_empty_or_hostile_job_id_still_yields_a_usable_folder() {
        assert_eq!(sanitize_job_id(""), "job");
        assert_eq!(sanitize_job_id("../.."), "job");
        assert_eq!(sanitize_job_id("///"), "job");
    }

    #[test]
    fn job_ids_cannot_grow_unbounded() {
        let long = "x".repeat(500);
        assert_eq!(sanitize_job_id(&long).len(), 64);
    }
}
