//! The command blocks and responses a drive-driving backend needs beyond the
//! CD-TEXT write itself.
//!
//! Windows gets most of this from IMAPI2 — `GetFeaturePage`, `GetModePage`,
//! `SetModePage`, `CurrentPhysicalMediaType` — so `win.rs` never builds these
//! by hand. Linux has no such layer: everything below the `SG_IO` ioctl is a
//! raw command block, so it is built here, where it can be checked against the
//! specification rather than against a stack of coasters.
//!
//! References are to MMC-3 (INCITS 360-2002), which unlike MMC-1 actually
//! describes CD-TEXT and `GET CONFIGURATION`.

use crate::model::BurnWriteCapabilities;

/// `GET CONFIGURATION`.
pub const OP_GET_CONFIGURATION: u8 = 0x46;
/// `MODE SENSE(10)`.
pub const OP_MODE_SENSE_10: u8 = 0x5A;
/// `MODE SELECT(10)`.
pub const OP_MODE_SELECT_10: u8 = 0x55;
/// `READ TOC/PMA/ATIP`.
pub const OP_READ_TOC: u8 = 0x43;
/// `SYNCHRONIZE CACHE`.
pub const OP_SYNCHRONIZE_CACHE: u8 = 0x35;
/// `BLANK`, for erasing a CD-RW.
pub const OP_BLANK: u8 = 0xA1;
/// `TEST UNIT READY`.
pub const OP_TEST_UNIT_READY: u8 = 0x00;
/// `READ CAPACITY`.
pub const OP_READ_CAPACITY: u8 = 0x25;

/// Feature code for CD Mastering, which carries the SAO and R-W subchannel
/// bits CD-TEXT depends on.
pub const FEATURE_CD_MASTERING: u16 = 0x002E;

/// Profile numbers, from the `GET CONFIGURATION` header.
pub const PROFILE_CD_ROM: u16 = 0x0008;
pub const PROFILE_CD_R: u16 = 0x0009;
pub const PROFILE_CD_RW: u16 = 0x000A;

/// The mode page this crate edits, re-exported so a backend needs one import.
pub use super::mode::PAGE_WRITE_PARAMETERS;

/// `GET CONFIGURATION` for one feature.
///
/// RT = 10b asks for that feature alone rather than the whole list, which keeps
/// the response small and the parsing honest.
pub fn get_configuration_cdb(feature: u16, len: u16) -> [u8; 10] {
    [
        OP_GET_CONFIGURATION,
        0x02,
        (feature >> 8) as u8,
        feature as u8,
        0,
        0,
        0,
        (len >> 8) as u8,
        len as u8,
        0,
    ]
}

/// `GET CONFIGURATION` asking only for the header, to learn the current profile.
pub fn get_configuration_header_cdb(len: u16) -> [u8; 10] {
    [
        OP_GET_CONFIGURATION,
        0x02,
        0,
        0,
        0,
        0,
        0,
        (len >> 8) as u8,
        len as u8,
        0,
    ]
}

/// `MODE SENSE(10)` for one page, current values.
pub fn mode_sense_10_cdb(page: u8, len: u16) -> [u8; 10] {
    [
        OP_MODE_SENSE_10,
        0,
        page & 0x3F,
        0,
        0,
        0,
        0,
        (len >> 8) as u8,
        len as u8,
        0,
    ]
}

/// `MODE SELECT(10)`.
///
/// PF is set (byte 1 bit 4) because the payload is a standard page rather than
/// a vendor format; SP is left clear so the drive is never asked to persist it.
pub fn mode_select_10_cdb(len: u16) -> [u8; 10] {
    [
        OP_MODE_SELECT_10,
        0x10,
        0,
        0,
        0,
        0,
        0,
        (len >> 8) as u8,
        len as u8,
        0,
    ]
}

/// `READ TOC/PMA/ATIP`. `format` is the 4-bit format field in byte 2.
pub fn read_toc_cdb(format: u8, track_session: u8, len: u16) -> [u8; 10] {
    [
        OP_READ_TOC,
        0x02, // MSF addressing
        format & 0x0F,
        0,
        0,
        0,
        track_session,
        (len >> 8) as u8,
        len as u8,
        0,
    ]
}

/// `SYNCHRONIZE CACHE`: flush the drive's buffer before letting go of it.
pub fn synchronize_cache_cdb() -> [u8; 10] {
    [OP_SYNCHRONIZE_CACHE, 0, 0, 0, 0, 0, 0, 0, 0, 0]
}

/// `BLANK`. `quick` clears the TOC only; a full blank rewrites the surface and
/// takes tens of minutes.
pub fn blank_cdb(quick: bool) -> [u8; 12] {
    // Byte 1 bits 2..0: 000b = blank the whole disc, 001b = minimal.
    let blanking_type = if quick { 0x01 } else { 0x00 };
    [OP_BLANK, blanking_type, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
}

/// `TEST UNIT READY`: the cheapest "is there a disc in there" there is.
pub fn test_unit_ready_cdb() -> [u8; 6] {
    [OP_TEST_UNIT_READY, 0, 0, 0, 0, 0]
}

/// TOC formats used for capacity.
pub const TOC_FORMAT_TOC: u8 = 0x00;
pub const TOC_FORMAT_ATIP: u8 = 0x04;
/// The lead-out's track number in a TOC.
pub const TRACK_LEAD_OUT: u8 = 0xAA;

/// Absolute MSF to a sector count usable as a capacity.
///
/// Addresses on a CD count from 00:02:00, not zero, so the 150-sector pregap
/// comes off: 79:59:74 is the 359 849 sectors an 80-minute disc holds, which is
/// the same number IMAPI2 reports as `LastPossibleStartOfLeadout`.
pub fn msf_to_capacity_sectors(minute: u8, second: u8, frame: u8) -> Option<u32> {
    let absolute = (u32::from(minute) * 60 + u32::from(second)) * 75 + u32::from(frame);
    absolute.checked_sub(150).filter(|sectors| *sectors > 0)
}

/// The last possible lead-out start, from an ATIP response.
///
/// A blank CD-R has no table of contents, so its capacity can only come from
/// ATIP — bytes 12..15 of the response, header included. This is the number a
/// burn is planned against, so getting it from the first thing that parsed is
/// not good enough: bytes 8..11 are the *lead-in* start and look equally
/// plausible.
pub fn parse_atip_capacity(data: &[u8]) -> Option<u32> {
    if data.len() < 15 {
        return None;
    }
    msf_to_capacity_sectors(data[12], data[13], data[14])
}

/// The lead-out address from a TOC, for a disc that already has one.
pub fn parse_toc_lead_out(data: &[u8]) -> Option<u32> {
    const HEADER: usize = 4;
    const DESCRIPTOR: usize = 8;
    let mut at = HEADER;
    while at + DESCRIPTOR <= data.len() {
        if data[at + 2] == TRACK_LEAD_OUT {
            // MSF addressing was requested, so byte 4 of the descriptor is
            // reserved and the address is the three that follow.
            return msf_to_capacity_sectors(data[at + 5], data[at + 6], data[at + 7]);
        }
        at += DESCRIPTOR;
    }
    None
}

/// What `READ DISC INFORMATION` says about the disc, byte 2 bits 1..0.
///
/// The drive's own answer, which is what both backends prefer over any
/// library's guess: on Windows IMAPI2's blankness heuristic goes on describing
/// a disc the way it did when a rehearsal ended, and Linux has no heuristic to
/// fall back on at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiscStatus {
    Empty,
    Incomplete,
    Complete,
    Other,
}

impl DiscStatus {
    /// Decode byte 2 of a `READ DISC INFORMATION` response.
    pub fn from_disc_information(byte2: u8) -> Self {
        match byte2 & 0x03 {
            0 => Self::Empty,
            1 => Self::Incomplete,
            2 => Self::Complete,
            _ => Self::Other,
        }
    }
}

/// Decode the CD Mastering feature descriptor (`002Eh`).
///
/// Byte 4 carries the capability bits and bytes 5..8 the maximum cue sheet
/// length. `win.rs` reads the identical descriptor through IMAPI2's
/// `GetFeaturePage` and decodes it inline; the two must stay in step.
///
/// `data` is the whole `GET CONFIGURATION` response, header included.
pub fn parse_cd_mastering_feature(data: &[u8]) -> Option<BurnWriteCapabilities> {
    let descriptor = find_feature(data, FEATURE_CD_MASTERING)?;
    if descriptor.len() < 8 {
        return None;
    }
    let flags = descriptor[4];
    Some(BurnWriteCapabilities {
        reported: true,
        rw_subchannel: flags & 0x01 != 0,
        cd_rewritable: flags & 0x02 != 0,
        test_write: flags & 0x04 != 0,
        raw_recording: flags & 0x08 != 0,
        raw_multisession: flags & 0x10 != 0,
        session_at_once: flags & 0x20 != 0,
        buffer_underrun_free: flags & 0x40 != 0,
        max_cue_sheet_bytes: (u32::from(descriptor[5]) << 16)
            | (u32::from(descriptor[6]) << 8)
            | u32::from(descriptor[7]),
    })
}

/// Walk the feature descriptors and return the one asked for.
///
/// The response is an 8-byte header followed by descriptors, each with its own
/// additional-length byte. A descriptor claiming more bytes than remain is
/// treated as the end rather than trusted into an out-of-bounds slice.
fn find_feature(data: &[u8], feature: u16) -> Option<&[u8]> {
    const HEADER: usize = 8;
    if data.len() < HEADER {
        return None;
    }
    let mut at = HEADER;
    while at + 4 <= data.len() {
        let code = (u16::from(data[at]) << 8) | u16::from(data[at + 1]);
        let additional = data[at + 3] as usize;
        let end = at.checked_add(4)?.checked_add(additional)?;
        if end > data.len() {
            return None;
        }
        if code == feature {
            return Some(&data[at..end]);
        }
        // A descriptor with no body would never advance the cursor.
        if additional == 0 {
            at += 4;
        } else {
            at = end;
        }
    }
    None
}

/// The profile the drive reports for the loaded disc, from bytes 6..8 of the
/// `GET CONFIGURATION` header. `0` means no profile, which is how a drive
/// describes an empty tray.
pub fn parse_current_profile(data: &[u8]) -> Option<u16> {
    if data.len() < 8 {
        return None;
    }
    let profile = (u16::from(data[6]) << 8) | u16::from(data[7]);
    (profile != 0).then_some(profile)
}

/// A human label for a profile, matching the wording the Windows path uses.
pub fn profile_label(profile: u16) -> &'static str {
    match profile {
        PROFILE_CD_ROM => "CD-ROM",
        PROFILE_CD_R => "CD-R",
        PROFILE_CD_RW => "CD-RW",
        _ => "an unsupported disc",
    }
}

/// Where the mode page starts inside a `MODE SENSE(10)` response.
///
/// The response is an 8-byte header, then any block descriptors — whose length
/// the header gives — and only then the page itself. Skipping the descriptors
/// is what stops the editor writing into the wrong bytes.
pub fn mode_page_from_sense(data: &[u8]) -> Option<&[u8]> {
    const HEADER: usize = 8;
    if data.len() < HEADER {
        return None;
    }
    let block_descriptors = ((usize::from(data[6])) << 8) | usize::from(data[7]);
    let start = HEADER.checked_add(block_descriptors)?;
    if start >= data.len() {
        return None;
    }
    let page = &data[start..];
    if page.len() < 2 {
        return None;
    }
    // Byte 1 is the page length, counting from byte 2.
    let declared = usize::from(page[1]) + 2;
    Some(&page[..declared.min(page.len())])
}

/// Wrap an edited page in the header `MODE SELECT(10)` expects.
///
/// The mode data length is the byte count that follows it, and the block
/// descriptor length must be zero: the page is being replaced, not the medium
/// layout, and a drive is entitled to reject a select that claims otherwise.
pub fn mode_select_payload(page: &[u8]) -> Vec<u8> {
    let mut out = vec![0_u8; 8];
    out.extend_from_slice(page);
    let following = (out.len() - 2) as u16;
    out[0] = (following >> 8) as u8;
    out[1] = following as u8;
    out
}

/// Turn a sense key, ASC and ASCQ into something a person can act on.
///
/// `win_sao.rs` has its own copy of this mapping against a fixed-format
/// buffer; the two say the same things and should be changed together.
pub fn describe_sense(key: u8, asc: u8, ascq: u8) -> String {
    let meaning = match (key, asc, ascq) {
        (0x05, 0x24, _) => "the drive rejected a field in the command",
        (0x05, 0x26, _) => "the drive rejected a parameter value",
        (0x05, 0x20, _) => "the drive does not support that command",
        (0x05, 0x64, _) => "the drive rejected the track mode for this disc",
        (0x02, 0x3A, _) => "there is no disc in the drive",
        (0x02, 0x04, 0x08) => "the drive is still preparing the disc",
        (0x02, 0x04, _) => "the drive is not ready yet",
        (0x02, _, _) => "the drive is not ready",
        (0x03, 0x0C, _) => "a write error on the disc",
        (0x03, _, _) => "the disc could not be read or written",
        (0x04, _, _) => "a hardware fault in the drive",
        (0x0B, 0x08, _) => "the drive lost its data stream (buffer underrun)",
        (0x06, 0x28, _) => "the disc was changed",
        _ => "the drive reported an error",
    };
    format!("{meaning} (sense {key:X}/{asc:02X}/{ascq:02X})")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_configuration_asks_for_one_feature() {
        let cdb = get_configuration_cdb(FEATURE_CD_MASTERING, 64);
        assert_eq!(cdb[0], OP_GET_CONFIGURATION);
        assert_eq!(cdb[1], 0x02, "RT=10b requests just the named feature");
        assert_eq!(&cdb[2..4], &[0x00, 0x2E]);
        assert_eq!(&cdb[7..9], &[0x00, 64]);
    }

    #[test]
    fn mode_select_sets_pf_and_leaves_sp_clear() {
        let cdb = mode_select_10_cdb(24);
        assert_eq!(cdb[0], OP_MODE_SELECT_10);
        assert_eq!(cdb[1] & 0x10, 0x10, "PF");
        assert_eq!(cdb[1] & 0x01, 0x00, "SP must stay clear");
    }

    #[test]
    fn blank_distinguishes_quick_from_full() {
        assert_eq!(blank_cdb(true)[1] & 0x07, 0x01);
        assert_eq!(blank_cdb(false)[1] & 0x07, 0x00);
    }

    /// A response carrying one CD Mastering descriptor.
    fn mastering_response(flags: u8, max_cue: u32) -> Vec<u8> {
        let mut data = vec![0_u8; 8];
        data[6] = 0x00;
        data[7] = 0x09; // current profile: CD-R
        data.extend_from_slice(&[0x00, 0x2E, 0x03, 0x04]);
        data.push(flags);
        data.push((max_cue >> 16) as u8);
        data.push((max_cue >> 8) as u8);
        data.push(max_cue as u8);
        data
    }

    #[test]
    fn cd_mastering_flags_decode_to_capabilities() {
        // SAO + R-W subchannel + test write + buffer-underrun-free.
        let caps = parse_cd_mastering_feature(&mastering_response(0x67, 6000)).expect("parsed");
        assert!(caps.reported);
        assert!(caps.session_at_once);
        assert!(caps.rw_subchannel);
        assert!(caps.test_write);
        assert!(caps.buffer_underrun_free);
        assert_eq!(caps.max_cue_sheet_bytes, 6000);
    }

    #[test]
    fn a_drive_without_the_mastering_feature_reports_nothing() {
        let mut data = vec![0_u8; 8];
        // A different feature, so the walk must not mistake it for 002Eh.
        data.extend_from_slice(&[0x00, 0x2B, 0x03, 0x04, 0xFF, 0, 0, 0]);
        assert!(parse_cd_mastering_feature(&data).is_none());
    }

    #[test]
    fn a_descriptor_longer_than_the_buffer_is_refused_not_trusted() {
        let mut data = vec![0_u8; 8];
        data.extend_from_slice(&[0x00, 0x2E, 0x03, 0xFF, 0x67]);
        assert!(parse_cd_mastering_feature(&data).is_none());
    }

    #[test]
    fn a_zero_length_descriptor_cannot_spin_the_walk() {
        let mut data = vec![0_u8; 8];
        data.extend_from_slice(&[0x00, 0x01, 0x03, 0x00]);
        data.extend_from_slice(&[0x00, 0x2E, 0x03, 0x04, 0x20, 0, 0, 100]);
        let caps = parse_cd_mastering_feature(&data).expect("found past the empty descriptor");
        assert!(caps.session_at_once);
    }

    #[test]
    fn the_current_profile_comes_out_of_the_header() {
        assert_eq!(
            parse_current_profile(&mastering_response(0, 0)),
            Some(PROFILE_CD_R)
        );
        assert_eq!(profile_label(PROFILE_CD_RW), "CD-RW");
    }

    #[test]
    fn an_empty_tray_reports_no_profile() {
        let data = vec![0_u8; 8];
        assert_eq!(parse_current_profile(&data), None);
    }

    #[test]
    fn the_mode_page_is_found_past_the_block_descriptors() {
        let mut data = vec![0_u8; 8];
        data[7] = 8; // one 8-byte block descriptor
        data.extend_from_slice(&[0xAA; 8]);
        data.extend_from_slice(&[0x05, 0x32]);
        data.extend_from_slice(&[0x11; 0x32]);

        let page = mode_page_from_sense(&data).expect("page located");
        assert_eq!(page[0] & 0x3F, PAGE_WRITE_PARAMETERS);
        assert_eq!(page.len(), 0x32 + 2);
    }

    #[test]
    fn a_sense_response_with_no_page_yields_nothing() {
        let data = vec![0_u8; 8];
        assert!(mode_page_from_sense(&data).is_none());
    }

    #[test]
    fn eighty_minutes_of_atip_is_the_capacity_we_already_assume() {
        // 79:59:74 is the standard 80-minute disc; the answer must be the same
        // 359 849 sectors used as the fallback everywhere else.
        let mut atip = vec![0_u8; 16];
        atip[12] = 79;
        atip[13] = 59;
        atip[14] = 74;
        assert_eq!(parse_atip_capacity(&atip), Some(359_849));
    }

    #[test]
    fn atip_capacity_is_not_the_lead_in_address() {
        // Bytes 8..11 are the lead-in start and parse just as happily; reading
        // those instead yields a disc that looks 97 minutes long.
        let mut atip = vec![0_u8; 16];
        atip[8] = 97;
        atip[9] = 27;
        atip[10] = 0;
        atip[12] = 79;
        atip[13] = 59;
        atip[14] = 74;
        assert_eq!(parse_atip_capacity(&atip), Some(359_849));
    }

    #[test]
    fn the_lead_out_is_found_by_its_track_number() {
        // Header, one ordinary track at 00:02:00, then the lead-out.
        let mut toc = vec![0_u8, 18, 1, 1];
        toc.extend_from_slice(&[0x00, 0x14, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00]);
        toc.extend_from_slice(&[0x00, 0x14, TRACK_LEAD_OUT, 0x00, 0x00, 60, 0, 0]);
        assert_eq!(parse_toc_lead_out(&toc), Some(60 * 60 * 75 - 150));
    }

    #[test]
    fn a_toc_without_a_lead_out_yields_nothing() {
        let toc = vec![0_u8, 10, 1, 1, 0x00, 0x14, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00];
        assert_eq!(parse_toc_lead_out(&toc), None);
    }

    #[test]
    fn an_address_inside_the_pregap_is_not_a_capacity() {
        assert_eq!(msf_to_capacity_sectors(0, 2, 0), None);
    }

    #[test]
    fn disc_status_decodes_the_two_bits_that_matter() {
        assert_eq!(DiscStatus::from_disc_information(0x00), DiscStatus::Empty);
        assert_eq!(DiscStatus::from_disc_information(0x01), DiscStatus::Incomplete);
        assert_eq!(DiscStatus::from_disc_information(0x02), DiscStatus::Complete);
    }

    #[test]
    fn disc_status_ignores_the_bits_above_it() {
        // Byte 2 also carries the last-session state and the erasable flag;
        // reading the whole byte would call a blank erasable disc non-empty.
        assert_eq!(DiscStatus::from_disc_information(0b0001_0000), DiscStatus::Empty);
    }

    #[test]
    fn sense_is_described_in_terms_a_person_can_act_on() {
        assert!(describe_sense(0x02, 0x3A, 0x00).starts_with("there is no disc"));
        assert!(describe_sense(0x0B, 0x08, 0x00).contains("buffer underrun"));
        // The retryable one the CD-TEXT lead-in backs off on.
        assert!(describe_sense(0x02, 0x04, 0x08).contains("still preparing"));
    }

    #[test]
    fn an_unmapped_sense_still_carries_its_numbers() {
        let text = describe_sense(0x09, 0x77, 0x12);
        assert!(text.contains("9/77/12"), "got {text}");
    }

    #[test]
    fn the_select_payload_declares_its_own_length_and_no_descriptors() {
        let page = vec![0x05, 0x32];
        let payload = mode_select_payload(&page);
        assert_eq!(payload.len(), 10);
        assert_eq!(&payload[6..8], &[0, 0], "no block descriptors");
        let declared = (usize::from(payload[0]) << 8) | usize::from(payload[1]);
        assert_eq!(declared, payload.len() - 2);
    }
}
