//! Disc layout and capacity arithmetic.
//!
//! Pure — no I/O, no COM, no Tauri. The burn refuses to start unless
//! `BurnPlan::fits` agrees, and the `burn_plan` command offers the same
//! arithmetic over IPC. The burner UI keeps its own copy in
//! `src/features/burner/utils/capacity.ts` so the disc ring can redraw on
//! every drag without a round-trip; a change to the layout here has to be made
//! there too, or the ring promises a fit the burn then refuses.

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
/// duration, which is what `burn_plan` passes while the running order is still
/// being built.
///
/// `gapless` is the user's toggle, and turning it off costs disc: a gapped
/// disc pauses for `PREGAP_SECTORS` — 150 sectors, two seconds — before every
/// track after the first, and those pauses take up as much of the disc as
/// audio would. Leaving them out of the arithmetic under-counted a gapped
/// running order by 150 sectors per gap, so `fits` could approve a queue the
/// disc has no room for and every `start_sector` after the first came back
/// short.
pub fn plan_disc(
    tracks: &[BurnTrackInput],
    capacity_sectors: u32,
    sector_hint: Option<&[u32]>,
    gapless: bool,
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

        // The pause before this track, on a gapped disc. Track 1 is skipped
        // because the cursor already starts after its mandatory pregap, which
        // gapless never removes either.
        if idx > 0 && !gapless {
            cursor = cursor.saturating_add(PREGAP_SECTORS);
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
        let plan = plan_disc(&[track("one", 60.0)], DEFAULT_80_MIN_SECTORS, None, true);
        assert_eq!(plan.tracks[0].start_sector, PREGAP_SECTORS);
        assert_eq!(plan.pregap_sectors, PREGAP_SECTORS);
    }

    #[test]
    fn tracks_are_laid_end_to_end() {
        let plan = plan_disc(
            &[track("a", 60.0), track("b", 30.0), track("c", 90.0)],
            DEFAULT_80_MIN_SECTORS,
            None,
            true,
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
        let plan = plan_disc(&[track("a", 60.0)], DEFAULT_80_MIN_SECTORS, Some(&hints), true);
        assert_eq!(plan.tracks[0].sectors, 61 * 75);
        assert_eq!(plan.total_sectors, 150 + 61 * 75);
    }

    #[test]
    fn a_full_80_minute_disc_fits_and_a_longer_one_does_not() {
        let fits = plan_disc(&[track("long", 4790.0)], DEFAULT_80_MIN_SECTORS, None, true);
        assert!(fits.fits, "79:50 should fit an 80-minute disc");

        let over = plan_disc(&[track("longer", 4810.0)], DEFAULT_80_MIN_SECTORS, None, true);
        assert!(!over.fits);
        assert!(over.warnings.iter().any(|w| w.contains("Over capacity")));
    }

    #[test]
    fn crossing_74_minutes_is_flagged_but_still_fits() {
        let plan = plan_disc(&[track("a", 4500.0)], DEFAULT_80_MIN_SECTORS, None, true);
        assert!(plan.fits);
        assert!(plan.past_red_book_74);
    }

    #[test]
    fn short_tracks_are_padded_to_the_four_second_floor() {
        let plan = plan_disc(&[track("blip", 1.2)], DEFAULT_80_MIN_SECTORS, None, true);
        assert_eq!(plan.tracks[0].sectors, MIN_TRACK_SECTORS);
        assert!(plan.warnings.iter().any(|w| w.contains("4-second minimum")));
    }

    #[test]
    fn more_than_99_tracks_is_rejected() {
        let many: Vec<_> = (0..100).map(|i| track(&format!("t{i}"), 10.0)).collect();
        let plan = plan_disc(&many, DEFAULT_80_MIN_SECTORS, None, true);
        assert!(!plan.fits);
        assert!(plan.warnings.iter().any(|w| w.contains("at most 99")));
    }

    #[test]
    fn an_empty_queue_does_not_fit() {
        let plan = plan_disc(&[], DEFAULT_80_MIN_SECTORS, None, true);
        assert!(!plan.fits);
        assert_eq!(plan.total_sectors, PREGAP_SECTORS);
    }

    #[test]
    fn zero_capacity_falls_back_to_an_80_minute_blank() {
        let plan = plan_disc(&[track("a", 60.0)], 0, None, true);
        assert_eq!(plan.capacity_sectors, DEFAULT_80_MIN_SECTORS);
    }

    #[test]
    fn a_gapped_disc_reserves_a_pause_before_every_track_but_the_first() {
        let queue = [track("a", 60.0), track("b", 30.0), track("c", 90.0)];
        let plan = plan_disc(&queue, DEFAULT_80_MIN_SECTORS, None, false);
        assert_eq!(plan.tracks[0].start_sector, 150, "the first pregap is unchanged");
        assert_eq!(plan.tracks[1].start_sector, 150 + 60 * 75 + 150);
        assert_eq!(plan.tracks[2].start_sector, 150 + 90 * 75 + 300);
        assert_eq!(plan.total_sectors, 150 + 180 * 75 + 300);
    }

    #[test]
    fn a_queue_that_only_fits_gapless_is_refused_when_it_is_gapped() {
        // Two tracks filling an 80-minute blank to the sector. The pause
        // between them is 150 sectors the disc does not have.
        let queue = [track("a", 1.0), track("b", 1.0)];
        let hints = [200_000, DEFAULT_80_MIN_SECTORS - PREGAP_SECTORS - 200_000];

        let gapless = plan_disc(&queue, DEFAULT_80_MIN_SECTORS, Some(&hints), true);
        assert_eq!(gapless.total_sectors, DEFAULT_80_MIN_SECTORS);
        assert!(gapless.fits);

        let gapped = plan_disc(&queue, DEFAULT_80_MIN_SECTORS, Some(&hints), false);
        assert_eq!(gapped.total_sectors, DEFAULT_80_MIN_SECTORS + PREGAP_SECTORS);
        assert!(!gapped.fits, "a gapped burn of this queue has to be refused");
        assert!(gapped.warnings.iter().any(|w| w.contains("Over capacity")));
    }

    #[test]
    fn a_full_disc_of_short_tracks_pays_for_ninety_eight_pauses() {
        // The worst case: 99 tracks is 98 gaps, 14 700 sectors, 3:16 of disc.
        let queue: Vec<_> = (0..99).map(|i| track(&format!("t{i}"), 10.0)).collect();
        let gapless = plan_disc(&queue, DEFAULT_80_MIN_SECTORS, None, true);
        let gapped = plan_disc(&queue, DEFAULT_80_MIN_SECTORS, None, false);
        assert_eq!(gapped.total_sectors - gapless.total_sectors, 98 * PREGAP_SECTORS);
        assert_eq!(gapped.total_sectors - gapless.total_sectors, 14_700);
    }

    #[test]
    fn a_single_track_costs_the_same_either_way() {
        // Nothing to sit between, so there is no pause to reserve.
        let queue = [track("alone", 60.0)];
        let gapless = plan_disc(&queue, DEFAULT_80_MIN_SECTORS, None, true);
        let gapped = plan_disc(&queue, DEFAULT_80_MIN_SECTORS, None, false);
        assert_eq!(gapless.total_sectors, gapped.total_sectors);
        assert_eq!(gapless.tracks[0].start_sector, gapped.tracks[0].start_sector);
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
