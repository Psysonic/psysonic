//! Tauri command surface for the CD burner.
//!
//! `burn_start` returns as soon as the job is registered; everything after
//! that arrives on `burn:progress` / `burn:complete`, the same shape the
//! device-sync job uses.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use tauri::{AppHandle, Manager};

use crate::fetch;
use crate::job;
use crate::model::{
    BurnMediaInfo, BurnOptions, BurnPhase, BurnPlan, BurnRecorder, BurnResult, BurnTrackInput,
    CdTextVerification, CD_SAMPLE_RATE, FRAMES_PER_SECTOR,
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

/// Upper bound on parallel renders.
///
/// Not a CPU limit — decoding is happy on far more cores than this. It bounds
/// peak disk instead: every worker can hold one fetched source at once, and
/// `estimated_peak_bytes` has to promise that up front. Eight sources of slack
/// is a fraction of the PCM the disc needs anyway, and eight-way decode already
/// outruns any optical drive.
const RENDER_MAX_WORKERS: usize = 8;

/// How many tracks to render at once.
fn render_workers(track_count: usize) -> usize {
    if track_count <= 1 {
        return 1;
    }
    let cores = std::thread::available_parallelism()
        .map(std::num::NonZeroUsize::get)
        .unwrap_or(1);
    cores.clamp(1, RENDER_MAX_WORKERS).min(track_count)
}

// ── Read-only queries ────────────────────────────────────────────────────────

/// Optical recorders attached to this machine.
///
/// Returns an empty list (not an error) on platforms without a backend, so
/// the UI can explain itself with `burn_is_supported`.
///
/// Off-thread for the same reason as `burn_media_state` below: a sync
/// `#[tauri::command]` resolves on the IPC thread, and enumerating drives is
/// blocking COM/ioctl work that can sit for seconds on a drive still spinning
/// up. Run inline it froze the whole app, transport controls included.
#[tauri::command]
#[specta::specta]
pub async fn burn_list_recorders() -> Result<Vec<BurnRecorder>, String> {
    tauri::async_runtime::spawn_blocking(platform::list_recorders)
        .await
        .map_err(|e| format!("recorder enumeration task failed: {e}"))?
}

/// Whether this platform has a burn backend at all.
#[tauri::command]
#[specta::specta]
pub fn burn_is_supported() -> bool {
    platform::is_supported()
}

/// What is in the drive right now: media type, blankness, capacity, speeds.
///
/// Off-thread: this is the slowest read on the page — it waits for the drive
/// to spin up and read the disc — and it runs when the burner page opens.
#[tauri::command]
#[specta::specta]
pub async fn burn_probe_media(recorder_id: String) -> Result<BurnMediaInfo, String> {
    tauri::async_runtime::spawn_blocking(move || platform::probe_media(&recorder_id))
        .await
        .map_err(|e| format!("media probe task failed: {e}"))?
}

/// Lay the running order out on a disc of `capacity_sectors`.
///
/// Pure arithmetic from the library's durations — instant, so the UI can call
/// it on every reorder. The authoritative sector counts only exist after
/// rendering, and `burn_start` re-checks against the real disc before writing.
#[tauri::command]
#[specta::specta]
pub fn burn_plan(
    tracks: Vec<BurnTrackInput>,
    capacity_sectors: u32,
    gapless: bool,
) -> Result<BurnPlan, String> {
    Ok(plan_disc(&tracks, capacity_sectors, None, gapless))
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

/// A cheap fingerprint of what is in the drive.
///
/// Polled while the burner page is open. The token is opaque: compare it with
/// the last one and re-probe when it differs. Never fails for an absent or busy
/// drive - a poll that raises errors would be a toast every few seconds.
#[tauri::command]
#[specta::specta]
pub async fn burn_media_state(recorder_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || platform::media_state(&recorder_id))
        .await
        .map_err(|e| format!("media state task failed: {e}"))?
}

/// Eject the disc and pull it back in, so the drive re-reads it.
///
/// The recovery for a disc the drive is still describing the way it did when a
/// rehearsal ended. A CD-R cannot be erased, so without this a stale
/// "not blank" verdict has no way out.
#[tauri::command]
#[specta::specta]
pub async fn burn_reload_media(recorder_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || platform::reload_media(&recorder_id))
        .await
        .map_err(|e| format!("reload task failed: {e}"))?
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

/// One burn at a time, enforced here and not only in the UI.
///
/// The page disables its own button while a job runs, but that is UI state: a
/// second window, a reload mid-burn, or a bare `invoke` reaches `burn_start`
/// with nothing in the way. Two jobs would then render a full disc each —
/// `check_free_space` sizes them independently, so together they can overrun
/// the volume — for minutes, before the hardware layer refuses the second with
/// a raw device error (`O_EXCL` on Linux, a bare HRESULT out of
/// `ExclusiveAccess` on Windows). Refusing up front costs nothing and can say
/// why.
static BURN_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Holds the single-burn latch and releases it however the job ends.
///
/// A guard rather than a bare `store(false)`: `burn_start` has two fallible
/// steps after taking it and the job thread can unwind, so Drop covers every
/// exit without the release being repeated on each path.
struct BurnLatch;

impl BurnLatch {
    fn acquire() -> Option<Self> {
        BURN_ACTIVE
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| BurnLatch)
    }
}

impl Drop for BurnLatch {
    fn drop(&mut self) {
        BURN_ACTIVE.store(false, Ordering::Release);
    }
}

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

    // Taken before anything is registered or created, so a refused second
    // attempt leaves nothing behind it.
    let latch =
        BurnLatch::acquire().ok_or_else(|| "A burn is already running.".to_string())?;

    // Workdir first, because it can fail: a registration made before it would
    // outlive the job that never started, and `burn_cancel` would then answer
    // `true` for a dead id for the rest of the session.
    let (workdir, workdir_lock) = burn_workdir(&app, &job_id)?;
    let cancel = job::register_job(&job_id);

    let spawn_id = job_id.clone();
    let spawned = std::thread::Builder::new()
        .name("psysonic-burn-job".into())
        .spawn(move || {
            // Held for the life of the job, released however it ends —
            // including an unwind out of `run_job`.
            let _held = latch;
            let outcome = run_job(&app, &job_id, &workdir, tracks, &options, &cancel);
            // Rendered PCM is large (up to ~846 MB for a full disc) and useless
            // once the burn is over, so clear it whatever happened. The lock is
            // released first: on Windows an open handle inside the folder
            // blocks the delete.
            drop(workdir_lock);
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
        });

    if let Err(error) = spawned {
        // The closure goes down with the failed spawn and takes the latch with
        // it; the registration is ours to undo.
        job::unregister_job(&spawn_id);
        return Err(format!("could not start the burn job: {error}"));
    }

    Ok(())
}

struct JobOutcome {
    tracks: u32,
    sectors: u32,
    cd_text_written: bool,
    cd_text_verification: Option<CdTextVerification>,
}

/// Where rendered PCM lives for the duration of one job.
fn burn_workdir(app: &AppHandle, job_id: &str) -> Result<(PathBuf, WorkdirLock), String> {
    let base = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("no cache directory available: {e}"))?;
    let root = base.join("burn");
    let dir = root.join(sanitize_job_id(job_id));
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create the render folder {}: {e}", dir.display()))?;
    let lock = claim_workdir(&dir)
        .ok_or_else(|| format!("the render folder {} is already in use", dir.display()))?;
    sweep_stale_workdirs(&root, &dir);
    Ok((dir, lock))
}

/// Marks a render folder as belonging to a job that is still running.
///
/// Held open for the life of the burn. The OS releases it when the process
/// does — including a crash, which is the whole point: the sweep has to tell
/// "abandoned" from "in progress" without being able to ask a process that may
/// no longer exist.
///
/// `BURN_ACTIVE` only latches one *process*, and the workdir root is shared
/// between instances: the dev and release builds carry the same bundle
/// identifier, so they resolve the same `app_cache_dir`, and on Linux the
/// single-instance D-Bus id includes the debug flag, so the two can run
/// together. Without this the newer one's sweep would delete the older one's
/// PCM out from under a running render.
struct WorkdirLock(std::fs::File);

impl Drop for WorkdirLock {
    fn drop(&mut self) {
        // Closing the handle would release the lock on its own; doing it here
        // says so out loud, and keeps the field from reading as dead weight to
        // anyone — the compiler included — who cannot see that its whole job is
        // to exist until this moment.
        let _ = fs4::FileExt::unlock(&self.0);
    }
}

fn claim_workdir(dir: &Path) -> Option<WorkdirLock> {
    let file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(dir.join(".lock"))
        .ok()?;
    // Named through the trait: std grew its own inherent `try_lock` on newer
    // toolchains, and an inherent method would silently win the lookup.
    fs4::FileExt::try_lock(&file).ok()?;
    Some(WorkdirLock(file))
}

/// Clear render folders a previous run left behind.
///
/// The job thread removes its own workdir when it finishes, but a crash or a
/// quit mid-burn never reaches that line, and a full disc of PCM is up to
/// ~846 MB. Nothing else has ever swept `burn/`, and every job id is unique,
/// so the orphans accumulated one per interrupted burn and stayed forever.
///
/// A folder is only removed once we hold its lock, which proves no live job in
/// any instance owns it — see `WorkdirLock`. Best-effort throughout: a folder
/// we cannot take or cannot delete is not worth failing a burn over, and the
/// next run will try again.
fn sweep_stale_workdirs(root: &Path, keep: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path == keep || !path.is_dir() {
            continue;
        }
        let claimed = claim_workdir(&path);
        if claimed.is_some() {
            // Close the handle first: on Windows an open file inside a
            // directory blocks the delete.
            drop(claimed);
            let _ = std::fs::remove_dir_all(&path);
        }
    }
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

/// Fetch (if needed), measure and render one track.
///
/// Runs on a render worker, so everything it touches is either owned or behind
/// `fetch_gate`. Returns the rendered track; the caller decides what a failure
/// means for the rest of the disc.
#[allow(clippy::too_many_arguments)] // A worker's whole world; bundling only moves the arity.
fn prepare_track(
    workdir: &std::path::Path,
    track: &BurnTrackInput,
    index: usize,
    options: &BurnOptions,
    http: Option<&reqwest::Client>,
    registry: Option<&ServerHttpRegistry>,
    fetch_gate: &Mutex<()>,
    cancel: &Arc<AtomicBool>,
    on_frames: &(dyn Fn(u64) + Sync),
) -> Result<RenderedTrack, String> {
    if cancel.load(Ordering::Relaxed) {
        return Err("cancelled".to_string());
    }

    // -- Fetch, when the offline cache does not already have it -----------
    let (source_path, fetched) = if fetch::has_local_source(track) {
        (
            PathBuf::from(track.source_path.clone().unwrap_or_default()),
            false,
        )
    } else {
        // One download at a time, whatever the worker count.
        let _serialised = fetch_gate.lock().unwrap_or_else(|e| e.into_inner());
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".to_string());
        }
        let client = http.ok_or_else(|| "internal error: fetch client missing".to_string())?;
        let path = tauri::async_runtime::block_on(fetch::fetch_track(
            track, index, workdir, client, registry, cancel,
        ))?;
        (path, true)
    };

    // -- Optional loudness measurement ------------------------------------
    let mut gain = 1.0_f32;
    if options.normalize {
        if cancel.load(Ordering::Relaxed) {
            if fetched {
                let _ = std::fs::remove_file(&source_path);
            }
            return Err("cancelled".to_string());
        }
        // A track we cannot measure stays at unity rather than failing the
        // whole disc.
        if let Ok(loudness) = render::measure_loudness(&source_path, cancel) {
            gain = render::normalization_gain(loudness.lufs, loudness.peak, NORMALIZE_TARGET_LUFS);
        }
    }

    // -- Render to Red Book PCM -------------------------------------------
    let dest = workdir.join(format!("{:02}.pcm", index + 1));
    let result = render::render_track(&source_path, &dest, gain, cancel, on_frames);

    // The source has served its purpose either way; a fetched copy is dead
    // weight from here on, and holding them all would multiply peak disk.
    if fetched {
        let _ = std::fs::remove_file(&source_path);
    }

    let mut track_out =
        result.map_err(|e| format!("“{}” could not be prepared: {e}", track.title))?;
    track_out.isrc = track.isrc.clone();
    track_out.title = track.title.clone();
    track_out.artist = track.artist.clone();
    Ok(track_out)
}

fn run_job(
    app: &AppHandle,
    job_id: &str,
    workdir: &std::path::Path,
    tracks: Vec<BurnTrackInput>,
    options: &BurnOptions,
    cancel: &Arc<AtomicBool>,
) -> Result<JobOutcome, String> {
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

    // ── Prepare every track: fetch → measure → render ────────────────────
    //
    // Rendering runs on several threads at once. Each track is independent: it
    // writes its own PCM file, and its normalisation gain is measured against a
    // fixed target rather than against the other tracks, so nothing forces a
    // global pass or an ordering. Decoding, resampling and dithering a full
    // disc is minutes of CPU, and doing it one core at a time was by far the
    // slowest part of a burn.
    //
    // Fetching stays serialised behind `fetch_gate`. It is network-bound, so
    // parallel downloads would only make one server race itself, and one live
    // source per worker is exactly what `estimated_peak_bytes` was told to
    // reserve.

    // Cheaper to refuse now than to fail after downloading 800 MB. The
    // estimate depends on the worker count, so it waits until that is known.
    let workers = render_workers(tracks.len());
    fetch::check_free_space(workdir, fetch::estimated_peak_bytes(&tracks, workers))?;

    // Duration-based estimate, only so the progress bar has a denominator. The
    // rendered sector counts below are what actually decide the disc.
    let frames_total: u64 = tracks
        .iter()
        .map(|track| {
            let seconds = track.duration_sec.max(0.0);
            (seconds * f64::from(CD_SAMPLE_RATE)).ceil() as u64
        })
        .sum();

    let next_index = AtomicUsize::new(0);
    let frames_done = AtomicU64::new(0);
    let slots: Vec<Mutex<Option<RenderedTrack>>> =
        (0..tracks.len()).map(|_| Mutex::new(None)).collect();
    let failure: Mutex<Option<String>> = Mutex::new(None);
    // Distinct from `cancel`, which means "the user pressed stop". A worker
    // failure must not raise that flag: the outer job reports any error as a
    // cancellation when it is set, which would silently swallow the real
    // reason the disc failed.
    let abort = AtomicBool::new(false);
    let in_flight: Mutex<BTreeSet<usize>> = Mutex::new(BTreeSet::new());
    let last_emit: Mutex<Instant> = Mutex::new(Instant::now());
    let fetch_gate: Mutex<()> = Mutex::new(());

    // The first failure wins and stops the rest; later ones are noise about a
    // job that is already over.
    let record_failure = |message: String| {
        let mut slot = failure.lock().unwrap_or_else(|e| e.into_inner());
        if slot.is_none() {
            *slot = Some(message);
        }
        // Stops workers claiming further tracks. Renders already in flight run
        // to the end — they are bounded, and letting them finish costs less
        // than threading a second cancel token through the decoder.
        abort.store(true, Ordering::Relaxed);
    };

    // Sectors rendered so far against the estimate, throttled the same way the
    // write phase is. `track_index` is the lowest track still in flight, so the
    // hub names something that is genuinely being worked on and never goes
    // backwards.
    let emit_render_progress = |force: bool| {
        {
            let mut last = last_emit.lock().unwrap_or_else(|e| e.into_inner());
            if !force && last.elapsed().as_millis() < job::PROGRESS_THROTTLE_MS {
                return;
            }
            *last = Instant::now();
        }
        let done = frames_done.load(Ordering::Relaxed) / FRAMES_PER_SECTOR as u64;
        let est = frames_total / FRAMES_PER_SECTOR as u64;
        let current = in_flight
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .next()
            .copied();
        job::emit_progress(
            app,
            job_id,
            BurnPhase::Rendering,
            current,
            done.min(u32::MAX as u64) as u32,
            est.min(u32::MAX as u64) as u32,
            None,
        );
    };

    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| loop {
                let index = next_index.fetch_add(1, Ordering::Relaxed);
                if index >= tracks.len()
                    || cancel.load(Ordering::Relaxed)
                    || abort.load(Ordering::Relaxed)
                {
                    return;
                }
                let track = &tracks[index];

                in_flight
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .insert(index);

                // Downloads are serialised but renders are not, so once any
                // track is decoding, a worker queueing for the network must not
                // flip the whole hub back to "Downloading". The opening fetches,
                // when nothing is decoding yet, are the ones worth showing.
                if !fetch::has_local_source(track) && frames_done.load(Ordering::Relaxed) == 0 {
                    job::emit_progress(app, job_id, BurnPhase::Fetching, Some(index), 0, 0, None);
                }

                let outcome = prepare_track(
                    workdir,
                    track,
                    index,
                    options,
                    http.as_ref(),
                    registry.as_deref(),
                    &fetch_gate,
                    cancel,
                    &|frames| {
                        frames_done.fetch_add(frames, Ordering::Relaxed);
                        emit_render_progress(false);
                    },
                );

                in_flight
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&index);

                match outcome {
                    Ok(rendered) => {
                        *slots[index].lock().unwrap_or_else(|e| e.into_inner()) = Some(rendered);
                        emit_render_progress(true);
                    }
                    Err(message) => {
                        // A user cancel surfaces here as Err("cancelled") too.
                        // It is recorded like any other stop reason; run_job
                        // checks the cancel flag first and reports it as a
                        // cancellation rather than a failure.
                        record_failure(message);
                        return;
                    }
                }
            });
        }
    });

    // Failure first: `record_failure` also raises the cancel flag to stop the
    // other workers, so testing the flag first would report every genuine
    // error as a user cancellation.
    if let Some(message) = failure.into_inner().unwrap_or_else(|e| e.into_inner()) {
        return Err(message);
    }
    if cancel.load(Ordering::Relaxed) {
        return Err("cancelled".to_string());
    }

    let mut rendered: Vec<RenderedTrack> = Vec::with_capacity(tracks.len());
    for (index, slot) in slots.into_iter().enumerate() {
        let track = slot
            .into_inner()
            .unwrap_or_else(|e| e.into_inner())
            .ok_or_else(|| format!("track {} was never rendered", index + 1))?;
        rendered.push(track);
    }

    // ── Re-check capacity against what actually rendered ─────────────────
    let hints: Vec<u32> = rendered.iter().map(|t| t.sectors).collect();
    let media = platform::probe_media(&options.recorder_id)?;
    let plan = plan_disc(&tracks, media.capacity_sectors, Some(&hints), options.gapless);
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
    fn a_single_track_never_spins_up_a_pool() {
        assert_eq!(render_workers(0), 1);
        assert_eq!(render_workers(1), 1);
    }

    #[test]
    fn workers_never_outnumber_the_tracks() {
        // Two tracks cannot use eight workers, and each idle worker would have
        // been counted against peak disk for a source it never fetches.
        assert_eq!(render_workers(2), 2);
    }

    #[test]
    fn workers_are_capped_however_many_cores_there_are() {
        assert!(render_workers(64) <= RENDER_MAX_WORKERS);
        assert!(render_workers(64) >= 1);
    }

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

    /// One test, not three, because `BURN_ACTIVE` is process-global and the
    /// test harness runs this binary's tests in parallel — separate tests would
    /// race each other for the latch and flake.
    #[test]
    fn the_latch_admits_one_burn_and_survives_a_job_that_unwinds() {
        let held = BurnLatch::acquire().expect("the latch starts free");
        assert!(
            BurnLatch::acquire().is_none(),
            "a second burn must be refused while the first holds the latch"
        );

        drop(held);
        let reacquired = BurnLatch::acquire().expect("dropping the guard frees the latch");
        drop(reacquired);

        // The guard exists so that a panic inside the job thread cannot strand
        // the latch and lock the user out of burning for the rest of the
        // session. Replacing it with a `store(false)` at the end of the closure
        // would pass every assertion above and fail this one.
        let hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let blew_up = std::panic::catch_unwind(|| {
            let _held = BurnLatch::acquire().expect("free again");
            panic!("the job thread died");
        });
        std::panic::set_hook(hook);
        assert!(blew_up.is_err(), "the test's own panic should have been caught");

        let after = BurnLatch::acquire();
        assert!(after.is_some(), "an unwinding job must still release the latch");
    }

    #[test]
    fn sweeping_clears_abandoned_render_folders_but_never_the_live_one() {
        let root = tempfile::tempdir().expect("tempdir");
        let live = root.path().join("burn-live");
        let stale_a = root.path().join("burn-crashed-yesterday");
        let stale_b = root.path().join("burn-quit-mid-render");
        for dir in [&live, &stale_a, &stale_b] {
            std::fs::create_dir_all(dir).expect("mkdir");
        }
        // Orphans hold real weight — a full disc is up to ~846 MB of PCM.
        std::fs::write(stale_a.join("01.pcm"), b"leftover").expect("write");

        sweep_stale_workdirs(root.path(), &live);

        assert!(live.is_dir(), "the folder this burn is about to use must survive");
        assert!(!stale_a.exists(), "a crashed run's folder and its PCM must go");
        assert!(!stale_b.exists());
    }

    #[test]
    fn sweeping_spares_a_folder_another_instance_is_still_using() {
        let root = tempfile::tempdir().expect("tempdir");
        let mine = root.path().join("burn-mine");
        let theirs = root.path().join("burn-other-instance");
        for dir in [&mine, &theirs] {
            std::fs::create_dir_all(dir).expect("mkdir");
        }

        // Stands in for a second app instance part-way through a render. It is
        // reachable: the dev and release builds share a bundle identifier and
        // therefore a cache directory, and `BURN_ACTIVE` is process-local, so
        // the lock is the only thing that can see it at all.
        let theirs_lock = claim_workdir(&theirs).expect("a fresh folder can be claimed");

        sweep_stale_workdirs(root.path(), &mine);
        assert!(
            theirs.is_dir(),
            "a folder another instance holds must survive the sweep — deleting it              would pull the PCM out from under a running render"
        );

        // Once that instance lets go, the folder is fair game again.
        drop(theirs_lock);
        sweep_stale_workdirs(root.path(), &mine);
        assert!(!theirs.exists(), "an unheld folder should be reclaimed");
    }
}
