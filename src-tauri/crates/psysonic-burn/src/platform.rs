//! Platform dispatch for the burn backend.
//!
//! The commands compile everywhere so the frontend keeps one typed surface and
//! the specta bindings stay platform-independent. Only the implementation is
//! gated: Windows gets IMAPI2, macOS gets `DiscRecording.framework`, and
//! everything else gets an honest refusal until the Linux (SG_IO) backend
//! lands.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use tauri::AppHandle;

use crate::model::{BurnMediaInfo, BurnOptions, BurnOutcome, BurnRecorder, CdTextVerification};
use crate::render::RenderedTrack;

/// Shown wherever a user without a backend reaches the burner.
#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
pub const UNSUPPORTED: &str =
    "CD burning is not available on this platform.";

/// Is there a burn backend on this platform at all? The UI uses this to show
/// an explanation instead of an empty drive list.
pub fn is_supported() -> bool {
    cfg!(any(windows, target_os = "macos", target_os = "linux"))
}

pub fn list_recorders() -> Result<Vec<BurnRecorder>, String> {
    #[cfg(windows)]
    {
        crate::win::list_recorders()
    }
    #[cfg(target_os = "linux")]
    {
        crate::linux::list_recorders()
    }
    #[cfg(target_os = "macos")]
    {
        crate::macos::list_recorders()
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
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
    #[cfg(target_os = "linux")]
    {
        crate::linux::probe_media(recorder_id)
    }
    #[cfg(target_os = "macos")]
    {
        crate::macos::probe_media(recorder_id)
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
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
    #[cfg(target_os = "linux")]
    {
        crate::linux::burn(app, job_id, tracks, options, cancel)
    }
    #[cfg(target_os = "macos")]
    {
        crate::macos::burn(app, job_id, tracks, options, cancel)
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
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
    #[cfg(target_os = "linux")]
    {
        crate::linux::verify_cd_text(recorder_id)
    }
    #[cfg(target_os = "macos")]
    {
        crate::macos::verify_cd_text(recorder_id)
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        let _ = recorder_id;
        Err(UNSUPPORTED.to_string())
    }
}

/// Eject and reload the disc so the drive re-reads it.
///
/// Windows only, and deliberately so: this exists because IMAPI2's blankness
/// heuristic keeps describing a disc the way it did when a rehearsal ended.
/// macOS asks DiscRecording directly and has no equivalent stale state, so
/// there is nothing there for a reload to fix.
pub fn reload_media(recorder_id: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        crate::win::reload_media(recorder_id)
    }
    #[cfg(target_os = "linux")]
    {
        crate::linux::reload_media(recorder_id)
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = recorder_id;
        Err("Reloading the disc is not available on this platform.".to_string())
    }
}

/// A cheap fingerprint of what is in the drive, for change detection.
///
/// Returns an opaque token: the caller compares it with the last one it saw and
/// runs a full `probe_media` when it differs. Keeping it opaque is the point -
/// each backend answers with whatever it can ask most cheaply, and none of that
/// leaks into the UI.
pub fn media_state(recorder_id: &str) -> Result<String, String> {
    #[cfg(windows)]
    {
        crate::win::media_state(recorder_id)
    }
    #[cfg(target_os = "linux")]
    {
        crate::linux::media_state(recorder_id)
    }
    #[cfg(target_os = "macos")]
    {
        crate::macos::media_state(recorder_id)
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        let _ = recorder_id;
        Ok("unsupported".to_string())
    }
}

pub fn erase(recorder_id: &str, quick: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        crate::win::erase(recorder_id, quick)
    }
    #[cfg(target_os = "linux")]
    {
        crate::linux::erase(recorder_id, quick)
    }
    #[cfg(target_os = "macos")]
    {
        crate::macos::erase(recorder_id, quick)
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        let _ = (recorder_id, quick);
        Err(UNSUPPORTED.to_string())
    }
}
