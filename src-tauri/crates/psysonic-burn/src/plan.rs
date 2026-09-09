//! Disc layout and capacity arithmetic.
//!
//! Pure — no I/O, no COM, no Tauri. Every capacity decision the UI makes comes
//! from here, and the burn refuses to start unless `BurnPlan::fits` agrees.

use crate::model::{
    sectors_to_seconds, seconds_to_sectors, BurnPlan, BurnPlanTrack, BurnTrackInput,
    DEFAULT_80_MIN_SECTORS, PREGAP_SECTORS, RED_BOOK_74_MIN_SECTORS,
};

/// Red Book allows at most 99 tracks in a session.
pub const MAX_TRACKS: usize = 99;

/// A CD track must be at least 4 seconds long.
pub const MIN_TRACK_SECTORS: u32 = 4 * crate::model::SECTORS_PER_SECOND;

/// Lay tracks out from an estimate, before anything has been decoded.
///
/// `sector_hint` supplies the real rendered length once it is known (after
/// [`crate::render`] has run); pass `None` to fall back on the library's
/// duration, which is what the UI does while the user is still building the
/// running order.
pub fn plan_disc(
    tracks: &[BurnTrackInput],
    capacity_sectors: u32,
    sector_hint: Option<&[u32]>,
) -> BurnPlan {
    let capacity = if capacity_sectors == 0 {
        DEFAULT_80_MIN_SECTORS
    } else {
        capacity_sectors
    };

    let mut warnings = Vec::new();
    let mut planned = Vec::with_capacity(tracks.len());
    let mut cursor = PREGAP_SECTORS;

    for (idx, track) in tracks.iter().enumerate() {
        let mut sectors = match sector_hint.and_then(|hints| hints.get(idx).copied()) {
            Some(rendered) => rendered,
            None => seconds_to_sectors(track.duration_sec),
        };

        if sectors < MIN_TRACK_SECTORS {
            // Red Book's 4-second floor. Padding is the only legal fix, and
            // it is silent, so say so rather than surprising the user.
            warnings.push(format!(
                "“{}” is shorter than the 4-second minimum and will be padded with silence.",
                track.title
            ));
            sectors = MIN_TRACK_SECTORS;
        }

        planned.push(BurnPlanTrack {
            number: (idx + 1) as u32,
            title: track.title.clone(),
            artist: track.artist.clone(),
            start_sector: cursor,
            sectors,
            duration_sec: sectors_to_seconds(sectors),
        });
        cursor = cursor.saturating_add(sectors);
    }

    if tracks.len() > MAX_TRACKS {
        warnings.push(format!(
            "A CD holds at most {MAX_TRACKS} tracks; remove {} to burn this disc.",
            tracks.len() - MAX_TRACKS
        ));
    }

    let total_sectors = cursor;
    let fits = total_sectors <= capacity && tracks.len() <= MAX_TRACKS && !tracks.is_empty();

    if total_sectors > capacity {
        let over = total_sectors - capacity;
        warnings.push(format!(
            "Over capacity by {} ({} sectors). Remove a track or use an 80-minute disc.",
            format_duration(sectors_to_seconds(over)),
            over
        ));
    }

    BurnPlan {
        tracks: planned,
        pregap_sectors: PREGAP_SECTORS,
        total_sectors,
        capacity_sectors: capacity,
        fits,
        past_red_book_74: total_sectors > RED_BOOK_74_MIN_SECTORS,
        warnings,
    }
}

/// `m:ss`, for warning copy. The MSF form lives in `model::format_msf`.
fn format_duration(seconds: f64) -> String {
    let whole = seconds.max(0.0).round() as u32;
    format!("{}:{:02}", whole / 60, whole % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(title: &str, duration_sec: f64) -> BurnTrackInput {
        BurnTrackInput {
            source_path: Some(format!("/music/{title}.flac")),
            download_url: None,
            suffix: Some("flac".to_string()),
            server_id: Some("srv".to_string()),
            size_bytes: None,
            title: title.to_string(),
            artist: "Test Artist".to_string(),
            duration_sec,
            isrc: None,
        }
    }

    #[test]
    fn pregap_precedes_the_first_track() {
        let plan = plan_disc(&[track("one", 60.0)], DEFAULT_80_MIN_SECTORS, None);
        assert_eq!(plan.tracks[0].start_sector, PREGAP_SECTORS);
        assert_eq!(plan.pregap_sectors, PREGAP_SECTORS);
    }

    #[test]
    fn tracks_are_laid_end_to_end() {
        let plan = plan_disc(
            &[track("a", 60.0), track("b", 30.0), track("c", 90.0)],
            DEFAULT_80_MIN_SECTORS,
            None,
        );
        assert_eq!(plan.tracks[0].start_sector, 150);
        assert_eq!(plan.tracks[1].start_sector, 150 + 60 * 75);
        assert_eq!(plan.tracks[2].start_sector, 150 + 90 * 75);
        assert_eq!(plan.total_sectors, 150 + 180 * 75);
    }

    #[test]
    fn rendered_sector_counts_win_over_duration_estimates() {
        // The library says 60 s; the decoder found 61 s worth of samples.
        let hints = [61 * 75];
        let plan = plan_disc(&[track("a", 60.0)], DEFAULT_80_MIN_SECTORS, Some(&hints));
        assert_eq!(plan.tracks[0].sectors, 61 * 75);
        assert_eq!(plan.total_sectors, 150 + 61 * 75);
    }

    #[test]
    fn a_full_80_minute_disc_fits_and_a_longer_one_does_not() {
        let fits = plan_disc(&[track("long", 4790.0)], DEFAULT_80_MIN_SECTORS, None);
        assert!(fits.fits, "79:50 should fit an 80-minute disc");

        let over = plan_disc(&[track("longer", 4810.0)], DEFAULT_80_MIN_SECTORS, None);
        assert!(!over.fits);
        assert!(over.warnings.iter().any(|w| w.contains("Over capacity")));
    }

    #[test]
    fn crossing_74_minutes_is_flagged_but_still_fits() {
        let plan = plan_disc(&[track("a", 4500.0)], DEFAULT_80_MIN_SECTORS, None);
        assert!(plan.fits);
        assert!(plan.past_red_book_74);
    }

    #[test]
    fn short_tracks_are_padded_to_the_four_second_floor() {
        let plan = plan_disc(&[track("blip", 1.2)], DEFAULT_80_MIN_SECTORS, None);
        assert_eq!(plan.tracks[0].sectors, MIN_TRACK_SECTORS);
        assert!(plan.warnings.iter().any(|w| w.contains("4-second minimum")));
    }

    #[test]
    fn more_than_99_tracks_is_rejected() {
        let many: Vec<_> = (0..100).map(|i| track(&format!("t{i}"), 10.0)).collect();
        let plan = plan_disc(&many, DEFAULT_80_MIN_SECTORS, None);
        assert!(!plan.fits);
        assert!(plan.warnings.iter().any(|w| w.contains("at most 99")));
    }

    #[test]
    fn an_empty_queue_does_not_fit() {
        let plan = plan_disc(&[], DEFAULT_80_MIN_SECTORS, None);
        assert!(!plan.fits);
        assert_eq!(plan.total_sectors, PREGAP_SECTORS);
    }

    #[test]
    fn zero_capacity_falls_back_to_an_80_minute_blank() {
        let plan = plan_disc(&[track("a", 60.0)], 0, None);
        assert_eq!(plan.capacity_sectors, DEFAULT_80_MIN_SECTORS);
    }

    #[test]
    fn msf_matches_the_sector_clock() {
        use crate::model::format_msf;
        assert_eq!(format_msf(0), "00:00:00");
        assert_eq!(format_msf(150), "00:02:00");
        assert_eq!(format_msf(74), "00:00:74");
        assert_eq!(format_msf(RED_BOOK_74_MIN_SECTORS), "74:00:00");
    }
}
