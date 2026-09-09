//! Platform dispatch for the burn backend.
//!
//! The commands compile everywhere so the frontend keeps one typed surface and
//! the specta bindings stay platform-independent. Only the implementation is
//! gated: Windows gets IMAPI2, everything else gets an honest refusal until
//! the Linux (SG_IO) and macOS (DiscRecording) backends land.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use tauri::AppHandle;

use crate::model::{BurnMediaInfo, BurnOptions, BurnOutcome, BurnRecorder, CdTextVerification};
use crate::render::RenderedTrack;

/// Shown wherever a non-Windows user reaches the burner.
#[cfg(not(windows))]
pub const UNSUPPORTED: &str =
    "CD burning is only available on Windows in this release. Linux and macOS support is planned.";

/// Is there a burn backend on this platform at all? The UI uses this to show
/// an explanation instead of an empty drive list.
pub fn is_supported() -> bool {
    cfg!(windows)
}

pub fn list_recorders() -> Result<Vec<BurnRecorder>, String> {
    #[cfg(windows)]
    {
        crate::win::list_recorders()
    }
    #[cfg(not(windows))]
    {
        // Not an error: an empty list plus `is_supported() == false` lets the
        // UI say why, rather than showing a failed-to-load toast.
        Ok(Vec::new())
    }
}

pub fn probe_media(recorder_id: &str) -> Result<BurnMediaInfo, String> {
    #[cfg(windows)]
    {
        crate::win::probe_media(recorder_id)
    }
    #[cfg(not(windows))]
    {
        let _ = recorder_id;
        Err(UNSUPPORTED.to_string())
    }
}

pub fn burn(
    app: AppHandle,
    job_id: String,
    tracks: Vec<RenderedTrack>,
    options: BurnOptions,
    cancel: Arc<AtomicBool>,
) -> Result<BurnOutcome, String> {
    #[cfg(windows)]
    {
        crate::win::burn(app, job_id, tracks, options, cancel)
    }
    #[cfg(not(windows))]
    {
        let _ = (app, job_id, tracks, options, cancel);
        Err(UNSUPPORTED.to_string())
    }
}

/// Read CD-TEXT back off the disc currently loaded.
pub fn verify_cd_text(recorder_id: &str) -> Result<CdTextVerification, String> {
    #[cfg(windows)]
    {
        crate::win::verify_cd_text(recorder_id)
    }
    #[cfg(not(windows))]
    {
        let _ = recorder_id;
        Err(UNSUPPORTED.to_string())
    }
}

pub fn erase(recorder_id: &str, quick: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        crate::win::erase(recorder_id, quick)
    }
    #[cfg(not(windows))]
    {
        let _ = (recorder_id, quick);
        Err(UNSUPPORTED.to_string())
    }
}
