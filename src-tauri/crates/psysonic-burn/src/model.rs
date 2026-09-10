//! Red Book constants and the DTOs shared across the IPC boundary.
//!
//! Everything here is platform-independent and serialisable; each backend
//! converts to and from these types, so the frontend never sees a COM object,
//! a CoreFoundation dictionary or a file descriptor.

use serde::{Deserialize, Serialize};
use specta::Type;

// ── Red Book geometry ────────────────────────────────────────────────────────

/// CD sectors per second. A "frame" in MSF notation is one sector.
pub const SECTORS_PER_SECOND: u32 = 75;

/// User bytes in one audio sector: 588 stereo frames × 2 channels × 2 bytes.
pub const BYTES_PER_AUDIO_SECTOR: usize = 2352;

/// Stereo sample frames in one audio sector. Track boundaries must land on a
/// multiple of this or the transition clicks.
pub const FRAMES_PER_SECTOR: usize = 588;

/// Mandatory pregap ahead of track 1 (2 seconds).
pub const PREGAP_SECTORS: u32 = 150;

/// The original Red Book capacity, still the safest target for old players.
pub const RED_BOOK_74_MIN_SECTORS: u32 = 333_000;

/// Typical capacity of an 80-minute CD-R (79:57:74). Used only when the drive
/// cannot report the media's real lead-out.
pub const DEFAULT_80_MIN_SECTORS: u32 = 359_849;

/// Red Book sample rate. Anything else has to be resampled.
pub const CD_SAMPLE_RATE: u32 = 44_100;

/// Red Book channel count.
pub const CD_CHANNELS: usize = 2;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// One optical recorder attached to the machine.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BurnRecorder {
    /// Opaque per-platform recorder id — an IMAPI2 id on Windows, a device
    /// path on Linux. Round-trips back on every later call, and each backend
    /// resolves it against the drives it actually found rather than trusting
    /// it as a path.
    pub id: String,
    /// Human label, e.g. `HL-DT-ST BD-RE WH16NS40`.
    pub name: String,
    /// Where the drive shows up in the filesystem: mount points on Windows
    /// (`["E:\\"]`), the device node on Linux (`["/dev/sr0"]`).
    pub volume_paths: Vec<String>,
    /// Whether the drive can write CD-R/CD-RW at all. A DVD-only reader is
    /// listed but not selectable.
    pub can_write_cd: bool,
    /// Whether this drive can carry CD-TEXT, from its own feature page rather
    /// than an assumption. See `capabilities`.
    pub supports_cd_text: bool,
    /// The raw answer behind `supports_cd_text`, so the UI can explain itself.
    pub capabilities: BurnWriteCapabilities,
}

/// What the drive reports it can do, read from MMC feature 002Eh
/// ("CD Mastering") — a read-only query, safe to run with any disc or none.
///
/// This is how the burner decides whether to offer CD-TEXT instead of guessing:
/// `rw_subchannel` is the drive's own answer to "can I write host-supplied R-W
/// subchannel data", which is exactly where CD-TEXT lives.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BurnWriteCapabilities {
    /// The drive answered the query at all. `false` means every flag below is
    /// a default, not a measurement.
    pub reported: bool,
    /// Session-At-Once — required for any CD-TEXT write.
    pub session_at_once: bool,
    /// Raw write types.
    pub raw_recording: bool,
    /// Raw multisession.
    pub raw_multisession: bool,
    /// Laser-off test writes.
    pub test_write: bool,
    /// Mastering onto CD-RW.
    pub cd_rewritable: bool,
    /// **Can write host-supplied R-W subchannel — i.e. can carry CD-TEXT.**
    pub rw_subchannel: bool,
    /// Zero-loss linking (burn-proof).
    pub buffer_underrun_free: bool,
    /// Largest cue sheet the drive will accept, in bytes.
    pub max_cue_sheet_bytes: u32,
}

impl BurnWriteCapabilities {
    /// CD-TEXT needs both a Session-At-Once write and R-W subchannel support.
    pub fn can_write_cd_text(&self) -> bool {
        self.reported && self.session_at_once && self.rw_subchannel
    }
}

/// What is actually in the drive right now.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BurnMediaInfo {
    /// `false` when the tray is empty or the disc is unreadable.
    pub present: bool,
    /// Blank enough to write an audio disc onto.
    pub blank: bool,
    /// CD-RW (or another rewritable) — offer Erase.
    pub erasable: bool,
    /// Physical media label, e.g. `CD-R`.
    pub media_type: String,
    /// Sectors available before the lead-out. `0` when unknown.
    pub capacity_sectors: u32,
    /// Write speeds the drive advertises for this disc, in sectors/second.
    /// 75 sectors/s = 1×.
    pub write_speeds: Vec<u32>,
    /// Set when the disc cannot be used, with the reason to show the user.
    pub blocker: Option<String>,
}

/// One track queued for the disc, as the frontend sends it.
///
/// Either `source_path` (already on disk) or `download_url` must be present.
/// When both are, the local file wins and nothing is fetched.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BurnTrackInput {
    /// Absolute path to a local audio file, when the track is already cached
    /// offline. `None` means the burner has to fetch it first.
    pub source_path: Option<String>,
    /// Original-file URL (`download.view`, never `stream.view` — a transcoded
    /// stream would put a lossy copy on a disc that cannot be rewritten).
    pub download_url: Option<String>,
    /// Container extension for the fetched file, e.g. `flac`. Used for the
    /// temp filename so the decoder's format hint is right.
    pub suffix: Option<String>,
    /// Server this track belongs to, so per-server HTTP settings (custom
    /// headers, self-signed certs) are applied to the fetch.
    pub server_id: Option<String>,
    /// File size the library reports, for the pre-flight disk estimate.
    /// `None` when unknown — the estimate then falls back on the duration.
    pub size_bytes: Option<u64>,
    pub title: String,
    pub artist: String,
    /// Duration the library believes the track has, in seconds. Only used for
    /// the pre-render estimate; the rendered sector count is authoritative.
    pub duration_sec: f64,
    /// Optional ISRC, written into the subchannel when present.
    pub isrc: Option<String>,
}

/// A planned track once its real length is known.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BurnPlanTrack {
    /// 1-based CD track number.
    pub number: u32,
    pub title: String,
    pub artist: String,
    /// Absolute LBA of the track's first sector.
    pub start_sector: u32,
    pub sectors: u32,
    pub duration_sec: f64,
}

/// The result of laying the queue out on a disc.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BurnPlan {
    pub tracks: Vec<BurnPlanTrack>,
    pub pregap_sectors: u32,
    /// Pregap + every track. This is what must fit.
    pub total_sectors: u32,
    pub capacity_sectors: u32,
    pub fits: bool,
    /// True once the disc runs past 74:00 — still legal on an 80-minute
    /// blank, but worth telling the user about.
    pub past_red_book_74: bool,
    /// Human-readable notes to surface in the UI (over capacity, too many
    /// tracks, unreadable source, …).
    pub warnings: Vec<String>,
}

/// Everything the user chose in the burn drawer.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BurnOptions {
    pub recorder_id: String,
    /// Sectors/second. `None` lets the drive pick.
    pub write_speed: Option<u32>,
    /// Run the whole write with the laser off. Nothing is committed to the
    /// disc, so this is the safe way to shake out a new drive.
    pub test_write: bool,
    /// Gapless (no 2-second gap between tracks). On by default.
    pub gapless: bool,
    /// Level every track to a shared gain before writing.
    pub normalize: bool,
    pub eject_when_done: bool,
    /// Optional Media Catalog Number (UPC/EAN) for the whole disc.
    pub media_catalog_number: Option<String>,
    /// Write a CD-TEXT lead-in. Ignored when the drive cannot do it.
    pub cd_text: bool,
    /// Disc-level CD-TEXT title.
    pub disc_title: Option<String>,
    /// Disc-level CD-TEXT performer.
    pub disc_performer: Option<String>,
}

/// Coarse stage of a running burn. The UI animates each differently.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum BurnPhase {
    /// Downloading a track the offline cache does not already hold.
    Fetching,
    /// Measuring loudness (only when `normalize` is on).
    Analyzing,
    /// Decoding + resampling to Red Book PCM.
    Rendering,
    /// Handing the image to the drive and locking it.
    Preparing,
    /// The laser is on.
    Writing,
    /// Closing the session / finalising.
    Closing,
}

impl BurnPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            BurnPhase::Fetching => "fetching",
            BurnPhase::Analyzing => "analyzing",
            BurnPhase::Rendering => "rendering",
            BurnPhase::Preparing => "preparing",
            BurnPhase::Writing => "writing",
            BurnPhase::Closing => "closing",
        }
    }
}

/// What reading CD-TEXT back off a disc found.
///
/// The three outcomes are deliberately distinct. An earlier version collapsed
/// "the drive refused the query" into "the disc has no CD-TEXT", which blamed
/// the drive for writing nothing when the truth may only have been that it
/// would not answer the question.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CdTextVerification {
    /// The read-back actually ran. When `false`, `packs` means nothing.
    pub checked: bool,
    /// Packs with a valid CRC found in the lead-in.
    pub packs: u32,
    /// Why the check could not run, when it could not.
    pub error: Option<String>,
}

impl CdTextVerification {
    pub fn unreadable(reason: impl Into<String>) -> Self {
        Self { checked: false, packs: 0, error: Some(reason.into()) }
    }

    pub fn found(packs: u32) -> Self {
        Self { checked: true, packs, error: None }
    }
}

/// Terminal outcome of a burn job, delivered on `burn:complete`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BurnResult {
    pub job_id: String,
    pub cancelled: bool,
    pub tracks_written: u32,
    pub sectors_written: u32,
    /// `None` on success; the reason otherwise.
    pub error: Option<String>,
    /// True when this was a laser-off rehearsal.
    pub test_write: bool,
    /// CD-TEXT was requested and written.
    pub cd_text_written: bool,
    /// What reading the finished disc back found. `None` when no read-back
    /// was attempted (a test write).
    pub cd_text_verification: Option<CdTextVerification>,
}

/// What a completed write actually did. Internal — the IPC shape is
/// `BurnResult`.
#[derive(Debug, Clone, Default)]
pub struct BurnOutcome {
    pub sectors: u32,
    pub cd_text_written: bool,
    pub cd_text_verification: Option<CdTextVerification>,
}

// ── Conversions ──────────────────────────────────────────────────────────────

/// Sectors → seconds.
pub fn sectors_to_seconds(sectors: u32) -> f64 {
    f64::from(sectors) / f64::from(SECTORS_PER_SECOND)
}

/// Seconds → whole sectors, rounded up so a partial sector is still reserved.
pub fn seconds_to_sectors(seconds: f64) -> u32 {
    if !seconds.is_finite() || seconds <= 0.0 {
        return 0;
    }
    (seconds * f64::from(SECTORS_PER_SECOND)).ceil() as u32
}

/// Format an absolute sector as MSF (`mm:ss:ff`), the notation printed on
/// every CD spec sheet and shown in the burner readout.
pub fn format_msf(sectors: u32) -> String {
    let frames = sectors % SECTORS_PER_SECOND;
    let total_seconds = sectors / SECTORS_PER_SECOND;
    format!(
        "{:02}:{:02}:{:02}",
        total_seconds / 60,
        total_seconds % 60,
        frames
    )
}
