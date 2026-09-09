//! `psysonic-burn` — audio CD authoring.
//!
//! Phase 1 of the burner: decode library tracks to Red Book PCM and write them
//! to a CD-R in Disc-At-Once via Windows IMAPI2. Gapless, with ISRC and MCN.
//!
//! **CD-TEXT is written** when the user asks for it and the drive reports it
//! can. IMAPI2 itself has no member for CD-TEXT, so that path drives the
//! recorder directly through `IDiscRecorder2Ex::SendCommand*` in a
//! Session-At-Once write, and reads the result back off the finished disc to
//! confirm. Everything else burns through IMAPI2. The design and the reasoning
//! live in `src/features/burner/README.md`.
//!
//! Layout:
//! - `model`    — Red Book constants and the IPC DTOs
//! - `fetch`    — pulls source audio down when it is not already cached
//! - `cdtext`   — CD-TEXT pack encoding (pure)
//! - `mmc`      — cue sheet / mode page / CDB construction (pure)
//! - `win_sao`  — the Session-At-Once write that carries CD-TEXT
//! - `plan`     — disc layout and capacity arithmetic (pure)
//! - `render`   — decode → 44.1 kHz / 16-bit / stereo (pure)
//! - `job`      — cancel registry and the two Tauri events
//! - `platform` — dispatch to the per-OS backend
//! - `win`      — IMAPI2
//! - `commands` — the Tauri surface
//!
//! `plan` and `render` hold the logic worth testing and carry no platform or
//! COM types, which keeps the untestable hardware layer thin.

pub use psysonic_core::{app_deprintln, app_eprintln, logging};

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

pub use commands::{
    burn_cancel, burn_erase, burn_is_supported, burn_list_recorders, burn_plan, burn_probe_media,
    burn_start, burn_verify_cd_text,
};
pub use model::{
    BurnMediaInfo, BurnOptions, BurnPhase, BurnPlan, BurnPlanTrack, BurnRecorder, BurnResult,
    BurnTrackInput,
};
