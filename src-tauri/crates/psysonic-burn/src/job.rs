//! Burn-job bookkeeping: the cancel registry and the two events the frontend
//! listens on.
//!
//! Mirrors the device-sync job shape (`device:sync:*`) so the frontend hook is
//! the same pattern the codebase already uses.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use tauri::{AppHandle, Emitter};

use crate::model::{format_msf, BurnPhase, BurnResult};

/// Progress ticks are throttled to this interval so a fast render cannot flood
/// the webview. The device-sync job uses the same budget.
pub const PROGRESS_THROTTLE_MS: u128 = 250;

type CancelRegistry = Mutex<HashMap<String, Arc<AtomicBool>>>;

fn cancel_flags() -> &'static CancelRegistry {
    static FLAGS: OnceLock<CancelRegistry> = OnceLock::new();
    FLAGS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Register a fresh cancel flag for `job_id`, replacing any stale one.
pub fn register_job(job_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut flags) = cancel_flags().lock() {
        flags.insert(job_id.to_string(), Arc::clone(&flag));
    }
    flag
}

/// Drop the flag once the job is over, so the registry does not grow.
pub fn unregister_job(job_id: &str) {
    if let Ok(mut flags) = cancel_flags().lock() {
        flags.remove(job_id);
    }
}

/// Ask a running job to stop at its next checkpoint.
///
/// Returns `false` when the job is already gone. Note that cancelling during
/// the write phase cannot un-burn what the laser has already committed — the
/// disc is spoiled either way, which is why the UI warns before offering it.
pub fn request_cancel(job_id: &str) -> bool {
    if let Ok(flags) = cancel_flags().lock() {
        if let Some(flag) = flags.get(job_id) {
            flag.store(true, Ordering::Relaxed);
            return true;
        }
    }
    false
}

/// Emit `burn:progress`.
///
/// `sectors_done` / `sectors_total` drive the ring fill. `track_index` is
/// 0-based and `None` outside the rendering and writing phases.
#[allow(clippy::too_many_arguments)] // One event payload; bundling it would just move the arity.
pub fn emit_progress(
    app: &AppHandle,
    job_id: &str,
    phase: BurnPhase,
    track_index: Option<usize>,
    sectors_done: u32,
    sectors_total: u32,
    buffer_percent: Option<u8>,
) {
    let _ = app.emit(
        "burn:progress",
        serde_json::json!({
            "jobId": job_id,
            "phase": phase.as_str(),
            "trackIndex": track_index,
            "sectorsDone": sectors_done,
            "sectorsTotal": sectors_total,
            "msf": format_msf(sectors_done),
            "bufferPercent": buffer_percent,
        }),
    );
}

/// Emit the terminal `burn:complete`. Exactly one per job.
pub fn emit_complete(app: &AppHandle, result: &BurnResult) {
    let _ = app.emit("burn:complete", result);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_registered_job_can_be_cancelled_once() {
        let flag = register_job("job-a");
        assert!(!flag.load(Ordering::Relaxed));
        assert!(request_cancel("job-a"));
        assert!(flag.load(Ordering::Relaxed));
        unregister_job("job-a");
    }

    #[test]
    fn cancelling_an_unknown_job_reports_failure_instead_of_panicking() {
        assert!(!request_cancel("no-such-job"));
    }

    #[test]
    fn unregistering_releases_the_flag() {
        register_job("job-b");
        unregister_job("job-b");
        assert!(!request_cancel("job-b"));
    }

    #[test]
    fn re_registering_the_same_id_hands_back_a_fresh_flag() {
        let first = register_job("job-c");
        request_cancel("job-c");
        assert!(first.load(Ordering::Relaxed));

        let second = register_job("job-c");
        assert!(
            !second.load(Ordering::Relaxed),
            "a re-registered job must not start out cancelled"
        );
        unregister_job("job-c");
    }
}
