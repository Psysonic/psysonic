//! Pulling source audio down before a burn.
//!
//! The burner used to require every track to be pinned offline first, which
//! meant a manual detour before every disc. Now a track that is not already on
//! disk is fetched as the first step of the burn itself.
//!
//! Two rules shape this module:
//!
//! 1. **Fetched bytes live in the job's own workdir**, never in the offline
//!    library. A full disc is up to ~800 MB of source audio; routing that
//!    through the shared media tiers would grow the user's offline storage
//!    against their configured limit and could evict tracks they pinned on
//!    purpose. Burning a CD must not cost you your offline library.
//! 2. **Originals only.** The URL must be `download.view`. `stream.view` can
//!    hand back a transcode (Psysonic has a per-address bitrate cap), and a
//!    lossy copy burned to a CD-R cannot be undone.
//!
//! The transport is Device Sync's, reused wholesale: `subsonic_http_client` +
//! `apply_server_http_get` (per-server headers / certs) +
//! `finalize_streamed_download` (`.part` file, atomic rename).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use psysonic_core::server_http::ServerHttpRegistry;
use psysonic_syncfs::file_transfer::{
    apply_server_http_get, finalize_streamed_download, subsonic_http_client,
};

use crate::model::{BurnTrackInput, BYTES_PER_AUDIO_SECTOR, SECTORS_PER_SECOND};

/// Generous per-track ceiling. A 10-minute 24/96 FLAC is well under this; a
/// response bigger than it is a misrouted HTML error page or a server bug, and
/// filling the disk with it helps nobody.
const MAX_TRACK_BYTES: u64 = 512 * 1024 * 1024;

/// Rough bytes-per-second for an unknown-size track: 1000 kbps, which sits
/// above typical CD-rate FLAC so the estimate errs on the safe side.
const ASSUMED_BYTES_PER_SECOND: f64 = 125_000.0;

/// Fetch timeout. Generous: a large FLAC over a slow remote link is normal.
const FETCH_TIMEOUT_SECS: u64 = 600;

/// What a burn will have to download before it can start rendering.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchPlan {
    /// Indices into the track list that need downloading, in order.
    pub indices: Vec<usize>,
    /// Estimated total download, in bytes.
    pub estimated_bytes: u64,
}

impl FetchPlan {
    pub fn is_empty(&self) -> bool {
        self.indices.is_empty()
    }
}

/// Decide which tracks need fetching.
///
/// A usable `source_path` wins: if the offline cache already holds the file,
/// the burn downloads nothing.
pub fn plan_fetch(tracks: &[BurnTrackInput]) -> FetchPlan {
    let mut indices = Vec::new();
    let mut estimated_bytes: u64 = 0;

    for (index, track) in tracks.iter().enumerate() {
        if has_local_source(track) {
            continue;
        }
        indices.push(index);
        estimated_bytes = estimated_bytes.saturating_add(estimated_size(track));
    }

    FetchPlan {
        indices,
        estimated_bytes,
    }
}

/// Does this track already point at a readable file on disk?
pub fn has_local_source(track: &BurnTrackInput) -> bool {
    track
        .source_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .is_some_and(|path| Path::new(path).is_file())
}

/// Best estimate of a track's download size.
fn estimated_size(track: &BurnTrackInput) -> u64 {
    if let Some(size) = track.size_bytes.filter(|bytes| *bytes > 0) {
        return size.min(MAX_TRACK_BYTES);
    }
    if track.duration_sec.is_finite() && track.duration_sec > 0.0 {
        return ((track.duration_sec * ASSUMED_BYTES_PER_SECOND) as u64).min(MAX_TRACK_BYTES);
    }
    0
}

/// Bytes the rendered Red Book PCM will occupy for `tracks`.
///
/// Independent of the source format — 176 400 bytes per second, always.
pub fn estimated_pcm_bytes(tracks: &[BurnTrackInput]) -> u64 {
    tracks
        .iter()
        .map(|track| {
            let seconds = if track.duration_sec.is_finite() && track.duration_sec > 0.0 {
                track.duration_sec
            } else {
                0.0
            };
            let sectors = (seconds * f64::from(SECTORS_PER_SECOND)).ceil() as u64;
            sectors.saturating_mul(BYTES_PER_AUDIO_SECTOR as u64)
        })
        .sum()
}

/// Peak disk a job needs in its workdir.
///
/// Sources are deleted as soon as each track is rendered, so the whole download
/// set is never live at once — without that, a FLAC disc would need ~1.6 GB
/// instead of ~900 MB. `concurrent_sources` is how many renders run in
/// parallel, and therefore how many sources can be on disk together; the
/// largest that many are counted, because the scheduler is free to pick any of
/// them at the same time.
pub fn estimated_peak_bytes(tracks: &[BurnTrackInput], concurrent_sources: usize) -> u64 {
    let mut sizes: Vec<u64> = tracks
        .iter()
        .filter(|track| !has_local_source(track))
        .map(estimated_size)
        .collect();
    sizes.sort_unstable_by(|a, b| b.cmp(a));

    let live_sources: u64 = sizes
        .into_iter()
        .take(concurrent_sources.max(1))
        .fold(0, u64::saturating_add);

    estimated_pcm_bytes(tracks).saturating_add(live_sources)
}

/// Free space check for the workdir's filesystem.
///
/// Returns the shortfall message when there is not enough room, so the burn
/// fails before downloading 800 MB rather than at sector 200 000.
pub fn check_free_space(workdir: &Path, needed: u64) -> Result<(), String> {
    // 64 MB of slack: filesystem overhead, and a disk driven to literally zero
    // free bytes misbehaves in ways unrelated to us.
    const SLACK: u64 = 64 * 1024 * 1024;
    let required = needed.saturating_add(SLACK);

    let available = fs4::available_space(workdir)
        .map_err(|e| format!("could not check free space on {}: {e}", workdir.display()))?;

    if available >= required {
        return Ok(());
    }
    Err(format!(
        "Not enough free space to prepare this disc: {} needed, {} available on {}.",
        human_bytes(required),
        human_bytes(available),
        workdir.display()
    ))
}

fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

/// Extension for the fetched file, sanitised so a hostile server value cannot
/// steer the path. Falls back to `audio`, which Symphonia probes by content.
fn safe_suffix(track: &BurnTrackInput) -> String {
    let cleaned: String = track
        .suffix
        .as_deref()
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect();
    if cleaned.is_empty() {
        "audio".to_string()
    } else {
        cleaned.to_ascii_lowercase()
    }
}

/// Download one track into `workdir`, returning the file written.
///
/// `index` is the 0-based position in the running order and only names the
/// file, so two tracks with the same title cannot collide.
pub async fn fetch_track(
    track: &BurnTrackInput,
    index: usize,
    workdir: &Path,
    client: &reqwest::Client,
    registry: Option<&ServerHttpRegistry>,
    cancel: &AtomicBool,
) -> Result<PathBuf, String> {
    if cancel.load(Ordering::Relaxed) {
        return Err("cancelled".to_string());
    }

    let url = track
        .download_url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .ok_or_else(|| {
            format!(
                "“{}” is not downloaded and no download address is available for it.",
                track.title
            )
        })?;

    let suffix = safe_suffix(track);
    let dest = workdir.join(format!("src-{:02}.{suffix}", index + 1));
    let part = workdir.join(format!("src-{:02}.{suffix}.part", index + 1));

    let response = apply_server_http_get(client, registry, track.server_id.as_deref(), url)
        .send()
        .await
        .map_err(|e| format!("“{}” could not be downloaded: {e}", track.title))?;

    if !response.status().is_success() {
        return Err(format!(
            "“{}” could not be downloaded: HTTP {}",
            track.title,
            response.status().as_u16()
        ));
    }

    // Reject an implausible body before writing it, not after.
    if let Some(len) = response.content_length() {
        if len > MAX_TRACK_BYTES {
            return Err(format!(
                "“{}” is {} — larger than the {} per-track limit; this is unlikely to be audio.",
                track.title,
                human_bytes(len),
                human_bytes(MAX_TRACK_BYTES)
            ));
        }
    }

    // The cancel flag belongs here. `stream_to_fresh_file` selects on it per
    // chunk, so passing `None` meant Stop went unseen until the whole file had
    // downloaded — up to the full fetch timeout on a slow link, with every other
    // worker stalled behind this one's slot on the fetch gate. The shared helper
    // signals it with the repo-wide "CANCELLED" sentinel; this crate keys
    // cancellation off its own lowercase spelling (`commands.rs:194`), so the
    // two have to be joined up or a cancel reads as a download failure.
    finalize_streamed_download(response, &dest, &part, Some(cancel))
        .await
        .map_err(|e| {
            if e == "CANCELLED" {
                "cancelled".to_string()
            } else {
                format!("“{}” could not be saved: {e}", track.title)
            }
        })?;

    if cancel.load(Ordering::Relaxed) {
        let _ = tokio::fs::remove_file(&dest).await;
        return Err("cancelled".to_string());
    }

    Ok(dest)
}

/// Shared HTTP client for a whole burn job.
pub fn fetch_client() -> Result<reqwest::Client, String> {
    subsonic_http_client(std::time::Duration::from_secs(FETCH_TIMEOUT_SECS))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(title: &str, source: Option<&str>, size: Option<u64>) -> BurnTrackInput {
        BurnTrackInput {
            source_path: source.map(str::to_string),
            download_url: Some(format!("https://srv.test/rest/download.view?id={title}")),
            suffix: Some("flac".to_string()),
            server_id: Some("srv".to_string()),
            size_bytes: size,
            title: title.to_string(),
            artist: "Artist".to_string(),
            duration_sec: 240.0,
            isrc: None,
        }
    }

    #[test]
    fn tracks_without_a_source_path_are_queued_for_fetching() {
        let tracks = [track("a", None, Some(1000)), track("b", None, Some(2000))];
        let plan = plan_fetch(&tracks);
        assert_eq!(plan.indices, vec![0, 1]);
        assert_eq!(plan.estimated_bytes, 3000);
    }

    #[test]
    fn a_source_path_that_does_not_exist_is_still_fetched() {
        // The offline cache can evict a file between queueing and burning, so a
        // stale path must not be trusted just because it is non-empty.
        let tracks = [track("a", Some("/nope/missing.flac"), Some(1000))];
        assert_eq!(plan_fetch(&tracks).indices, vec![0]);
    }

    #[test]
    fn an_existing_local_file_is_not_fetched() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("real.flac");
        std::fs::write(&path, b"audio").expect("write");

        let tracks = [track("a", Some(path.to_str().expect("utf8")), Some(1000))];
        let plan = plan_fetch(&tracks);
        assert!(plan.is_empty());
        assert_eq!(plan.estimated_bytes, 0);
    }

    #[test]
    fn a_blank_source_path_counts_as_missing() {
        let tracks = [track("a", Some("   "), Some(1000))];
        assert_eq!(plan_fetch(&tracks).indices, vec![0]);
    }

    #[test]
    fn an_unknown_size_falls_back_to_the_duration() {
        let tracks = [track("a", None, None)];
        let plan = plan_fetch(&tracks);
        // 240 s at the assumed rate.
        assert_eq!(plan.estimated_bytes, (240.0 * ASSUMED_BYTES_PER_SECOND) as u64);
    }

    #[test]
    fn absurd_reported_sizes_are_clamped() {
        let tracks = [track("a", None, Some(u64::MAX))];
        assert_eq!(plan_fetch(&tracks).estimated_bytes, MAX_TRACK_BYTES);
    }

    #[test]
    fn pcm_size_follows_the_red_book_rate_not_the_source_format() {
        // One minute of CD audio is 60 × 75 × 2352 bytes.
        let mut one_minute = track("a", None, Some(1));
        one_minute.duration_sec = 60.0;
        assert_eq!(estimated_pcm_bytes(&[one_minute]), 60 * 75 * 2352);
    }

    #[test]
    fn peak_usage_counts_the_live_sources_not_all_of_them() {
        // Sources are deleted as each track renders, so five 100 MB downloads
        // only need as many live at once as there are render workers.
        let tracks: Vec<_> = (0..5)
            .map(|i| track(&format!("t{i}"), None, Some(100 * 1024 * 1024)))
            .collect();
        let pcm = estimated_pcm_bytes(&tracks);

        assert_eq!(estimated_peak_bytes(&tracks, 1), pcm + 100 * 1024 * 1024);
        assert_eq!(estimated_peak_bytes(&tracks, 3), pcm + 300 * 1024 * 1024);
    }

    #[test]
    fn peak_usage_never_counts_more_sources_than_exist() {
        let tracks: Vec<_> = (0..2)
            .map(|i| track(&format!("t{i}"), None, Some(100 * 1024 * 1024)))
            .collect();
        let pcm = estimated_pcm_bytes(&tracks);
        // Sixteen workers, two downloads: the estimate is bounded by reality.
        assert_eq!(estimated_peak_bytes(&tracks, 16), pcm + 200 * 1024 * 1024);
    }

    #[test]
    fn peak_usage_treats_zero_workers_as_one() {
        let tracks = vec![track("t", None, Some(100 * 1024 * 1024))];
        let pcm = estimated_pcm_bytes(&tracks);
        assert_eq!(estimated_peak_bytes(&tracks, 0), pcm + 100 * 1024 * 1024);
    }

    #[test]
    fn suffixes_are_sanitised_into_a_safe_filename_part() {
        let mut hostile = track("a", None, None);
        hostile.suffix = Some("../../evil".to_string());
        assert_eq!(safe_suffix(&hostile), "evil");

        hostile.suffix = Some("FLAC".to_string());
        assert_eq!(safe_suffix(&hostile), "flac");

        hostile.suffix = Some("///".to_string());
        assert_eq!(safe_suffix(&hostile), "audio");

        hostile.suffix = None;
        assert_eq!(safe_suffix(&hostile), "audio");
    }

    #[test]
    fn free_space_passes_when_the_disk_has_room() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(check_free_space(dir.path(), 1024).is_ok());
    }

    #[test]
    fn free_space_fails_with_a_readable_message_when_it_does_not() {
        let dir = tempfile::tempdir().expect("tempdir");
        let error = check_free_space(dir.path(), u64::MAX / 2).expect_err("should not fit");
        assert!(error.contains("Not enough free space"), "got: {error}");
    }

    #[test]
    fn byte_sizes_read_as_human_units() {
        assert_eq!(human_bytes(512), "512 B");
        assert_eq!(human_bytes(1536), "1.5 KB");
        assert_eq!(human_bytes(5 * 1024 * 1024), "5.0 MB");
        assert_eq!(human_bytes(3 * 1024 * 1024 * 1024), "3.0 GB");
    }
}
