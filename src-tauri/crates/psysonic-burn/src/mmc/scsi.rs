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

use std::time::Duration;

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

/// What a finished write actually left on the disc, judged from the disc
/// rather than from the drive's replies while writing.
///
/// Every command in a write can appear to succeed without a single sector
/// reaching the medium. On Windows that once happened to every Session-At-Once
/// burn on drives that refused the cue sheet: IMAPI2 reports a refusal as a
/// success code, so the whole write "finished" at bus speed and left a blank
/// disc. That is now caught where it happens, but the replies are still not the
/// disc, so this asks the disc afterwards.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteVerdict {
    /// The disc holds what was written.
    Written,
    /// The disc still reads as blank, with no table of contents: nothing the
    /// write sent is known to have reached it.
    NothingWritten,
    /// Something reached the disc but its session was left open. Not safe to
    /// write again, and it may not play.
    Unfinished,
    /// The drive would not say. Treated as neither success nor failure.
    Unknown,
}

/// Judge a finished, non-rehearsal write from what the disc now reports.
///
/// `toc_tracks` is the track count from `READ TOC`, and it outranks the disc
/// status. A drive can go on describing a disc as it was when it went in, and a
/// table of contents with tracks in it is the disc itself proving it holds
/// audio. Without that second opinion a stale "empty" would send a written disc
/// round for a second burn — or, where there is no second write path, report
/// a good disc as a failure.
///
/// A burn here always closes the disc (`mode::apply` writes single-session), so
/// a successful one reads Complete, and Incomplete with no readable TOC is the
/// abnormal case it looks like.
pub fn verdict_after_write(status: Option<DiscStatus>, toc_tracks: Option<u8>) -> WriteVerdict {
    if toc_tracks.is_some_and(|tracks| tracks > 0) {
        return WriteVerdict::Written;
    }
    match status {
        Some(DiscStatus::Complete) => WriteVerdict::Written,
        Some(DiscStatus::Empty) => WriteVerdict::NothingWritten,
        Some(DiscStatus::Incomplete) => WriteVerdict::Unfinished,
        Some(DiscStatus::Other) | None => WriteVerdict::Unknown,
    }
}

/// `READ TOC` format `0000b` allocation: the four-byte header plus eight bytes
/// for each of 99 tracks and the lead-out.
pub const TOC_FULL_BYTES: u16 = 4 + 8 * 100;

/// Tracks in a `READ TOC` format `0000b` response.
///
/// Header bytes 2 and 3 are the first and last track numbers. A blank disc has
/// no table of contents and most drives refuse the command outright; anything
/// that does not describe at least one real track is `None`, not a guess.
pub fn parse_toc_track_count(data: &[u8]) -> Option<u8> {
    if data.len() < 4 {
        return None;
    }
    let (first, last) = (data[2], data[3]);
    if first == 0 || last < first || last > 99 {
        return None;
    }
    Some(last - first + 1)
}

/// How many times to ask for the disc's status after a write before giving up.
pub const POST_WRITE_STATUS_ATTEMPTS: u32 = 5;

/// The pause between those asks. A drive can still be settling after
/// `SYNCHRONIZE CACHE` returns, and answers NOT READY until it has.
pub const POST_WRITE_STATUS_PAUSE: Duration = Duration::from_secs(1);

/// The same question after a tray cycle, which is a much longer wait: the drive
/// has to spin the disc up and read it again before it can say anything about
/// it.
///
/// Measured on an LG WH10LS30 over USB, ejecting and closing the tray three
/// times: `READ DISC INFORMATION` answered at 7.8 s, 8.0 s and 7.8 s, and then
/// reported the disc correctly. The post-write budget above — five asks a
/// second apart — gave up before every one of them, which made a drive that was
/// merely slow look like a drive that would not answer.
///
/// `TEST UNIT READY` is no use as a readiness signal here: across those same
/// three cycles it never returned GOOD, including while `READ DISC INFORMATION`
/// was already answering.
///
/// 10 seconds is a quarter more than the measured figure. Overrunning it costs
/// only the log line saying the drive would not describe the disc — nothing
/// fails and no disc is at risk — so a slower drive buys back at most that one
/// misleading line. Polling four times a second rather than once keeps the
/// normal case close to the 8 seconds it actually takes.
pub const AFTER_RELOAD_ATTEMPTS: u32 = 40;

/// See `AFTER_RELOAD_ATTEMPTS`.
pub const AFTER_RELOAD_PAUSE: Duration = Duration::from_millis(250);

/// Ask until the drive gives an answer, up to `attempts` times.
///
/// Only a non-answer is retried. An answer — even an unwelcome one — is what
/// the disc says, and asking again would just be waiting for a different one.
pub fn settle<T>(attempts: u32, pause: Duration, mut ask: impl FnMut() -> Option<T>) -> Option<T> {
    for attempt in 0..attempts {
        if let Some(answer) = ask() {
            return Some(answer);
        }
        if attempt + 1 < attempts && !pause.is_zero() {
            std::thread::sleep(pause);
        }
    }
    None
}

/// Pull the key/ASC/ASCQ out of a sense buffer, fixed or descriptor format.
///
/// Response code `72h`/`73h` is the descriptor format, where the three live in
/// different bytes from the fixed format every older drive uses. Reading the
/// fixed offsets out of a descriptor buffer yields a plausible-looking and
/// entirely wrong diagnosis.
///
/// The two formats also need different amounts of the buffer filled in, so the
/// length is checked per format rather than once up front. A descriptor buffer
/// carries all three bytes by offset 3, so four is all it needs, where the
/// fixed format cannot answer until byte 13. Holding both to fourteen threw
/// away sense that was short but complete: a drive answering a write with a
/// descriptor 2/04/08 then looked undiagnosable and was never retried.
pub fn sense_triplet(sense: &[u8], written: usize) -> Option<(u8, u8, u8)> {
    let len = written.min(sense.len());
    if len < 4 {
        return None;
    }
    match sense[0] & 0x7F {
        0x72 | 0x73 => Some((sense[1] & 0x0F, sense[2], sense[3])),
        _ if len >= 14 => Some((sense[2] & 0x0F, sense[12], sense[13])),
        _ => None,
    }
}

/// The key/ASC/ASCQ of a command the drive refused, if the sense says it did.
///
/// NO SENSE (`0h`) and RECOVERED ERROR (`1h`) both mean the command completed,
/// so neither is a refusal. A zeroed buffer decodes as NO SENSE, which is what
/// lets a caller zero the buffer, send, and ask this whatever the transport
/// claimed about the outcome.
pub fn refusal(sense: &[u8], written: usize) -> Option<(u8, u8, u8)> {
    sense_triplet(sense, written).filter(|(key, _, _)| *key > 0x01)
}

/// Shown when a write left the disc with an open session and no readable table
/// of contents.
pub const UNFINISHED_WRITE_MESSAGE: &str =
    "The drive left the disc with an unfinished session, so this burn cannot be trusted and the disc may not play.";

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
/// Shared by every backend that reads sense — the Windows Session-At-Once write
/// and the Linux SG_IO transport both call it — so the wording a user sees for a
/// given refusal does not depend on the platform they are on.
pub fn describe_sense(key: u8, asc: u8, ascq: u8) -> String {
    let meaning = match (key, asc, ascq) {
        (0x05, 0x24, _) => "the drive rejected a field in the command",
        (0x05, 0x26, _) => "the drive rejected a parameter value",
        (0x05, 0x20, _) => "the drive does not support that command",
        (0x05, 0x64, _) => "the drive rejected the track mode for this disc",
        (0x05, 0x2C, _) => "the drive refused a command out of sequence",
        (0x05, 0x21, _) => "the drive refused the write address",
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
    fn fixed_format_sense_reads_from_the_classic_offsets() {
        let mut sense = [0_u8; 32];
        sense[0] = 0x70;
        sense[2] = 0x05;
        sense[12] = 0x24;
        sense[13] = 0x00;
        assert_eq!(sense_triplet(&sense, 18), Some((0x05, 0x24, 0x00)));
    }

    #[test]
    fn descriptor_format_sense_reads_from_its_own_offsets() {
        // The same failure in the newer layout. Reading bytes 2/12/13 here
        // would report a completely different fault.
        let mut sense = [0_u8; 32];
        sense[0] = 0x72;
        sense[1] = 0x05;
        sense[2] = 0x24;
        sense[3] = 0x00;
        assert_eq!(sense_triplet(&sense, 18), Some((0x05, 0x24, 0x00)));
    }

    #[test]
    fn a_descriptor_header_on_its_own_is_enough_to_diagnose() {
        // Eight bytes is a whole descriptor header, and the key, ASC and ASCQ
        // all live inside it. The retryable lead-in sense arrives this way.
        let mut sense = [0_u8; 32];
        sense[0] = 0x72;
        sense[1] = 0x02;
        sense[2] = 0x04;
        sense[3] = 0x08;
        assert_eq!(sense_triplet(&sense, 8), Some((0x02, 0x04, 0x08)));
    }

    #[test]
    fn a_truncated_sense_buffer_is_not_guessed_at() {
        let sense = [0_u8; 32];
        assert_eq!(sense_triplet(&sense, 4), None);
    }

    #[test]
    fn a_short_fixed_format_buffer_is_not_guessed_at_either() {
        // Fixed format keeps ASC and ASCQ at bytes 12 and 13, so eight bytes
        // says nothing about them and the zeros sitting there must not be read
        // as a diagnosis.
        let mut sense = [0_u8; 32];
        sense[0] = 0x70;
        sense[2] = 0x05;
        assert_eq!(sense_triplet(&sense, 8), None);
    }

    #[test]
    fn a_drive_saying_no_is_a_refusal() {
        // Byte for byte what an LG WH10LS30 on USB put in the sense buffer for
        // TEST UNIT READY with the tray empty — while IMAPI2 called it success.
        let sense = [
            0x70, 0, 0x02, 0, 0, 0, 0, 0x0A, 0, 0, 0, 0, 0x3A, 0x01, 0, 0, 0, 0,
        ];
        assert_eq!(refusal(&sense, sense.len()), Some((0x02, 0x3A, 0x01)));
    }

    #[test]
    fn a_zeroed_buffer_or_a_recovered_error_is_not_a_refusal() {
        assert_eq!(refusal(&[0_u8; 18], 18), None);

        // RECOVERED ERROR: the drive had trouble, and the command completed.
        let mut sense = [0_u8; 18];
        sense[0] = 0x70;
        sense[2] = 0x01;
        sense[12] = 0x17;
        assert_eq!(refusal(&sense, 18), None);
    }

    #[test]
    fn a_disc_still_blank_after_a_write_received_nothing() {
        assert_eq!(
            verdict_after_write(Some(DiscStatus::Empty), None),
            WriteVerdict::NothingWritten
        );
    }

    #[test]
    fn a_closed_disc_is_written() {
        assert_eq!(
            verdict_after_write(Some(DiscStatus::Complete), None),
            WriteVerdict::Written
        );
    }

    #[test]
    fn a_table_of_contents_outranks_a_stale_status() {
        // A drive can keep describing the disc it was handed; the TOC is the disc.
        assert_eq!(
            verdict_after_write(Some(DiscStatus::Empty), Some(12)),
            WriteVerdict::Written
        );
        assert_eq!(
            verdict_after_write(Some(DiscStatus::Incomplete), Some(3)),
            WriteVerdict::Written
        );
        assert_eq!(verdict_after_write(None, Some(1)), WriteVerdict::Written);
    }

    #[test]
    fn an_open_session_with_no_table_of_contents_is_unfinished() {
        assert_eq!(
            verdict_after_write(Some(DiscStatus::Incomplete), None),
            WriteVerdict::Unfinished
        );
    }

    #[test]
    fn no_answer_is_neither_success_nor_failure() {
        assert_eq!(verdict_after_write(None, None), WriteVerdict::Unknown);
        assert_eq!(
            verdict_after_write(Some(DiscStatus::Other), None),
            WriteVerdict::Unknown
        );
        // A TOC that lists no tracks is no evidence of a write.
        assert_eq!(
            verdict_after_write(Some(DiscStatus::Empty), Some(0)),
            WriteVerdict::NothingWritten
        );
    }

    #[test]
    fn toc_track_count_reads_the_header() {
        assert_eq!(parse_toc_track_count(&[0, 10, 1, 12]), Some(12));
        assert_eq!(parse_toc_track_count(&[0, 10, 3, 5, 0, 0]), Some(3));
    }

    #[test]
    fn toc_track_count_refuses_anything_that_is_not_a_track_list() {
        assert_eq!(parse_toc_track_count(&[0, 2, 1]), None);
        assert_eq!(parse_toc_track_count(&[0, 2, 0, 0]), None);
        assert_eq!(parse_toc_track_count(&[0, 2, 5, 2]), None);
        assert_eq!(parse_toc_track_count(&[0, 2, 1, 170]), None);
    }

    #[test]
    fn the_post_reload_wait_covers_a_drive_spinning_a_disc_back_up() {
        // Measured at ~8 s on an LG WH10LS30 over USB. A budget trimmed back
        // near that figure would report a slow drive as a silent one, which is
        // the mistake this constant exists to correct.
        let window = AFTER_RELOAD_PAUSE * AFTER_RELOAD_ATTEMPTS;
        assert!(
            window >= Duration::from_secs(10),
            "{window:?} is not enough after a tray cycle"
        );
        assert!(
            AFTER_RELOAD_PAUSE <= Duration::from_millis(500),
            "polling this slowly adds delay the drive did not ask for"
        );
    }

    #[test]
    fn settle_retries_only_a_non_answer() {
        let zero = Duration::ZERO;

        let mut calls = 0;
        let answer = settle(5, zero, || {
            calls += 1;
            (calls == 3).then_some(DiscStatus::Empty)
        });
        assert_eq!((answer, calls), (Some(DiscStatus::Empty), 3));

        let mut calls = 0;
        let answer = settle::<DiscStatus>(4, zero, || {
            calls += 1;
            None
        });
        assert_eq!((answer, calls), (None, 4));

        // An unwelcome answer is still an answer: asked once, never again.
        let mut calls = 0;
        let answer = settle(5, zero, || {
            calls += 1;
            Some(DiscStatus::Empty)
        });
        assert_eq!((answer, calls), (Some(DiscStatus::Empty), 1));
    }

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
        let toc = vec![
            0_u8, 10, 1, 1, 0x00, 0x14, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00,
        ];
        assert_eq!(parse_toc_lead_out(&toc), None);
    }

    #[test]
    fn an_address_inside_the_pregap_is_not_a_capacity() {
        assert_eq!(msf_to_capacity_sectors(0, 2, 0), None);
    }

    #[test]
    fn disc_status_decodes_the_two_bits_that_matter() {
        assert_eq!(DiscStatus::from_disc_information(0x00), DiscStatus::Empty);
        assert_eq!(
            DiscStatus::from_disc_information(0x01),
            DiscStatus::Incomplete
        );
        assert_eq!(
            DiscStatus::from_disc_information(0x02),
            DiscStatus::Complete
        );
    }

    #[test]
    fn disc_status_ignores_the_bits_above_it() {
        // Byte 2 also carries the last-session state and the erasable flag;
        // reading the whole byte would call a blank erasable disc non-empty.
        assert_eq!(
            DiscStatus::from_disc_information(0b0001_0000),
            DiscStatus::Empty
        );
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
