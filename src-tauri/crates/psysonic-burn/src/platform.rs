//! Platform dispatch for the burn backend.
//!
//! The commands compile everywhere so the frontend keeps one typed surface and
//! the specta bindings stay platform-independent. Only the implementation is
//! gated: Windows gets IMAPI2, macOS gets `DiscRecording.framework`, Linux
//! gets `SG_IO` passthrough, and anything else gets an honest refusal.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use tauri::AppHandle;

use crate::model::{BurnMediaInfo, BurnOptions, BurnOutcome, BurnRecorder};
// Gated with its only user, `verify_cd_text`, which is macOS-only. An
// unconditional import warns as unused on every other platform, and
// deleting it outright to silence that is what broke the macOS build:
// no CI job compiles for macOS, so the error was invisible here.
#[cfg(target_os = "macos")]
use crate::model::CdTextVerification;
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

/// Read CD-TEXT back off the disc currently loaded, on macOS.
///
/// macOS only, and deliberately narrow. This used to dispatch to all three
/// backends for a "check the disc" button that no longer exists. The two other
/// arms went with it: Windows reads its own CD-TEXT back through
/// `win_sao::verify_cd_text` at the end of a burn, and Linux through
/// `read_cd_text`, so neither needed a by-recorder-id entry point once the
/// button was gone.
///
/// It survives here because `macos::verify_cd_text` IS still live — the burn
/// reads its own CD-TEXT back through it — and `mod macos` is private, so the
/// runtime smoke test in `tests/macos_smoke.rs` has no other way to reach it.
/// That test pins a distinction worth keeping: "could not check" must never be
/// reported as "the drive wrote nothing".
#[cfg(target_os = "macos")]
pub fn verify_cd_text(recorder_id: &str) -> Result<CdTextVerification, String> {
    crate::macos::verify_cd_text(recorder_id)
}

/// Eject and reload the disc so the drive re-reads it.
///
/// Not a library quirk, whatever it first looked like: a rehearsal leaves the
/// drive holding a session it opened and never closed, and until the medium is
/// reloaded it stops calling the disc blank. Windows made that look like a bug
/// in IMAPI2's blankness heuristic, but the Linux path has no heuristic - it
/// asks the drive with READ DISC INFORMATION - and gets the same answer, so the
/// cause is the drive, not the library above it.
///
/// Implemented on Windows and Linux. macOS ejects through its burn completion
/// action instead, so it has no separate call to make here.
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
