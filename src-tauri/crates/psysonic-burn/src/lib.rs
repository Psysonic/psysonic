//! `psysonic-burn` — audio CD authoring.
//!
//! Decode library tracks to Red Book PCM and write them to a CD-R in
//! Disc-At-Once. Gapless, with ISRC and MCN. Windows goes through IMAPI2,
//! macOS through `DiscRecording.framework`, Linux through `SG_IO` passthrough.
//!
//! **CD-TEXT is written by default**, whenever the drive reports it can, and
//! read back off the finished disc to confirm rather than assumed.
//!
//! How it gets there differs. IMAPI2 has no member for CD-TEXT, so on Windows
//! that case drives the recorder directly through
//! `IDiscRecorder2Ex::SendCommand*` in a Session-At-Once write and everything
//! else burns through IMAPI2. Linux has no library at all, so Session-At-Once
//! is its only write mode either way, running the same `mmc`/`cdtext` code.
//! macOS needs none of it — `DiscRecording` writes the lead-in itself. The
//! design and the reasoning live in `src/features/burner/README.md`.
//!
//! Layout:
//! - `model`       — Red Book constants and the IPC DTOs
//! - `fetch`       — pulls source audio down when it is not already cached
//! - `cdtext`      — CD-TEXT pack encoding and read-back scoring (pure)
//! - `mmc`         — cue sheet / mode page / CDB construction (pure)
//! - `cdrom_info`  — parses the kernel's drive table (pure; Linux uses it)
//! - `plan`        — disc layout and capacity arithmetic (pure)
//! - `render`      — decode → 44.1 kHz / 16-bit / stereo (pure)
//! - `job`         — cancel registry and the two Tauri events
//! - `platform`    — dispatch to the per-OS backend
//! - `win`         — IMAPI2
//! - `win_sao`     — the Windows Session-At-Once write that carries CD-TEXT
//! - `macos`       — DiscRecording.framework
//! - `linux`       — SG_IO passthrough, with its own Session-At-Once write
//! - `commands`    — the Tauri surface
//!
//! `plan` and `render` hold the logic worth testing and carry no platform or
//! COM types, which keeps the untestable hardware layer thin.

pub use psysonic_core::{app_deprintln, app_eprintln, logging};

pub mod cdrom_info;
pub mod cdtext;
pub mod commands;
pub mod fetch;
pub mod job;
pub mod mmc;
pub mod model;
pub mod plan;
pub mod platform;
pub mod render;

#[cfg(windows)]
mod win;
#[cfg(windows)]
mod win_sao;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
mod macos_ffi;

#[cfg(target_os = "linux")]
mod linux;

pub use commands::{
    burn_cancel, burn_erase, burn_is_supported, burn_list_recorders, burn_plan, burn_probe_media,
    burn_start,
};
pub use model::{
    BurnMediaInfo, BurnOptions, BurnPhase, BurnPlan, BurnPlanTrack, BurnRecorder, BurnResult,
    BurnTrackInput,
};
