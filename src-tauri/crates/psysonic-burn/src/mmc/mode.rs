//! Write Parameters — mode page `05h`.
//!
//! Sent before the cue sheet to put the drive into Session-At-Once. The page
//! is read back from the drive first and edited in place rather than built
//! from nothing: drives carry vendor defaults in the reserved fields, and
//! overwriting those is one of the ways a cue sheet gets rejected.

/// Mode page code for Write Parameters.
pub const PAGE_WRITE_PARAMETERS: u8 = 0x05;

/// Write Type values (byte 2, bits 3..0).
pub const WRITE_TYPE_SESSION_AT_ONCE: u8 = 0x02;

/// Test Write lives in byte 2 bit 4 — the laser stays off and nothing is
/// committed, which is how a new drive should always be tried first.
const TEST_WRITE_BIT: u8 = 0x10;

/// Buffer-underrun-free recording, byte 2 bit 6.
const BUFE_BIT: u8 = 0x40;

/// Data Block Type values (byte 4, bits 3..0).
pub const BLOCK_TYPE_RAW_PW: u8 = 0x03;

/// Session Format for an audio (CD-DA / CD-ROM) disc, byte 8.
pub const SESSION_FORMAT_CDDA: u8 = 0x00;

/// Multi-session field, byte 3 bits 7..6.
///
/// `00` — no B0 pointer, next session not allowed. This is what a blank disc
/// written in one session wants. `01` (B0 = FF:FF:FF) is for closing the last
/// session of a *multi-session* CD-R and writes a different TOC, so using it
/// here put a value on the disc that described something we were not making.
const MULTISESSION_SINGLE: u8 = 0x00;

/// Track Mode nibble for two audio channels, no pre-emphasis, copy prohibited
/// (byte 3 bits 3..0 — the same CONTROL encoding the cue sheet uses).
pub const TRACK_MODE_AUDIO: u8 = 0x00;

/// How a burn wants the page configured.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WriteParameters {
    /// Rehearse with the laser off.
    pub test_write: bool,
    /// Ask for zero-loss linking when the drive supports it.
    pub buffer_underrun_free: bool,
    /// Raw P-W blocks, needed when a CD-TEXT lead-in is being supplied.
    pub raw_subchannel: bool,
}

/// Offsets of the fields this module edits, measured from the start of the
/// page (the byte holding the page code).
mod offset {
    pub const WRITE_TYPE: usize = 2;
    pub const TRACK_MODE: usize = 3;
    pub const DATA_BLOCK_TYPE: usize = 4;
    pub const SESSION_FORMAT: usize = 8;
}

/// Smallest page this module will edit: through the session-format byte.
const MIN_PAGE_LEN: usize = offset::SESSION_FORMAT + 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModePageError {
    /// The drive returned something too short to be a Write Parameters page.
    TooShort(usize),
    /// The page code did not match `05h`.
    WrongPage(u8),
}

impl std::fmt::Display for ModePageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ModePageError::TooShort(len) => write!(
                f,
                "the drive returned a {len}-byte write-parameters page; at least {MIN_PAGE_LEN} are needed"
            ),
            ModePageError::WrongPage(code) => {
                write!(f, "expected mode page 05h, the drive returned {code:#04x}")
            }
        }
    }
}

impl std::error::Error for ModePageError {}

/// Edit a Write Parameters page read from the drive.
///
/// Only the fields the burn actually depends on are touched; everything else —
/// vendor defaults, link size, the reserved bytes — is left exactly as the
/// drive reported it.
pub fn apply(page: &[u8], params: WriteParameters) -> Result<Vec<u8>, ModePageError> {
    if page.len() < MIN_PAGE_LEN {
        return Err(ModePageError::TooShort(page.len()));
    }
    // Bit 6 is Parameters Savable and bit 7 Page Set; the code is bits 5..0.
    let code = page[0] & 0x3F;
    if code != PAGE_WRITE_PARAMETERS {
        return Err(ModePageError::WrongPage(code));
    }

    let mut out = page.to_vec();

    // Parameters Savable must be clear on the way back in: a drive is entitled
    // to reject a MODE SELECT that asks it to persist the page, and some do.
    out[0] &= 0x7F;

    let mut write_type = out[offset::WRITE_TYPE] & !0x0F;
    write_type |= WRITE_TYPE_SESSION_AT_ONCE;
    if params.test_write {
        write_type |= TEST_WRITE_BIT;
    } else {
        write_type &= !TEST_WRITE_BIT;
    }
    if params.buffer_underrun_free {
        write_type |= BUFE_BIT;
    } else {
        write_type &= !BUFE_BIT;
    }
    out[offset::WRITE_TYPE] = write_type;

    // Multi-session and track mode share byte 3 with the drive's own FP and
    // Copy bits, so only the two multi-session bits are replaced. Overwriting
    // the byte wholesale threw away settings the drive had put there.
    out[offset::TRACK_MODE] = (out[offset::TRACK_MODE] & 0x3F) | MULTISESSION_SINGLE;

    out[offset::DATA_BLOCK_TYPE] = if params.raw_subchannel {
        (out[offset::DATA_BLOCK_TYPE] & !0x0F) | BLOCK_TYPE_RAW_PW
    } else {
        out[offset::DATA_BLOCK_TYPE] & !0x0F
    };

    out[offset::SESSION_FORMAT] = SESSION_FORMAT_CDDA;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A plausible page as a drive would report it, with vendor bits set in
    /// the fields this module must not disturb.
    fn drive_page() -> Vec<u8> {
        let mut page = vec![0_u8; 0x38];
        page[0] = 0x85; // page set + savable + code 05h
        page[1] = 0x32; // page length
        page[2] = 0b0000_0101; // some other write type
        page[3] = 0b1100_0100; // vendor multisession + track mode
        page[4] = 0x08; // some other block type
        page[5] = 0xAB; // link size — must survive
        page[7] = 0x0F; // host application code — must survive
        page[8] = 0x20; // session format
        page[0x30] = 0x5A; // vendor tail — must survive
        page
    }

    fn params() -> WriteParameters {
        WriteParameters { test_write: false, buffer_underrun_free: false, raw_subchannel: true }
    }

    #[test]
    fn selects_session_at_once() {
        let out = apply(&drive_page(), params()).expect("edits");
        assert_eq!(out[2] & 0x0F, WRITE_TYPE_SESSION_AT_ONCE);
    }

    #[test]
    fn raw_subchannel_selects_block_type_three() {
        let out = apply(&drive_page(), params()).expect("edits");
        assert_eq!(out[4] & 0x0F, BLOCK_TYPE_RAW_PW);
    }

    #[test]
    fn without_cd_text_the_block_type_returns_to_plain_audio() {
        let out = apply(&drive_page(), WriteParameters { raw_subchannel: false, ..params() })
            .expect("edits");
        assert_eq!(out[4] & 0x0F, 0x00);
    }

    #[test]
    fn the_test_write_bit_is_set_and_cleared_on_request() {
        let on = apply(&drive_page(), WriteParameters { test_write: true, ..params() })
            .expect("edits");
        assert_eq!(on[2] & 0x10, 0x10);

        let off = apply(&drive_page(), params()).expect("edits");
        assert_eq!(off[2] & 0x10, 0x00);
    }

    #[test]
    fn buffer_underrun_free_is_opt_in() {
        let off = apply(&drive_page(), params()).expect("edits");
        assert_eq!(off[2] & 0x40, 0x00);

        let on = apply(&drive_page(), WriteParameters { buffer_underrun_free: true, ..params() })
            .expect("edits");
        assert_eq!(on[2] & 0x40, 0x40);
    }

    #[test]
    fn a_single_session_disc_gets_no_b0_pointer() {
        // `01` is for closing the last session of a multi-session CD-R and
        // writes a different TOC; a one-shot audio disc wants `00`.
        let out = apply(&drive_page(), params()).expect("edits");
        assert_eq!(out[3] >> 6, 0b00, "multi-session: no B0 pointer");
    }

    #[test]
    fn the_drives_own_bits_in_byte_three_survive() {
        // Byte 3 carries FP and Copy alongside the multi-session field.
        let page = drive_page();
        let out = apply(&page, params()).expect("edits");
        assert_eq!(out[3] & 0x3F, page[3] & 0x3F, "only the top two bits are ours");
    }

    #[test]
    fn the_parameters_savable_flag_is_cleared_for_mode_select() {
        let page = drive_page();
        assert_ne!(page[0] & 0x80, 0, "fixture must start with PS set");
        let out = apply(&page, params()).expect("edits");
        assert_eq!(out[0] & 0x80, 0, "PS must be clear on the way back to the drive");
        assert_eq!(out[0] & 0x3F, 0x05, "the page code itself is untouched");
    }

    #[test]
    fn the_session_format_says_cd_da() {
        let out = apply(&drive_page(), params()).expect("edits");
        assert_eq!(out[8], SESSION_FORMAT_CDDA);
    }

    #[test]
    fn fields_the_burn_does_not_own_survive_untouched() {
        let page = drive_page();
        let out = apply(&page, params()).expect("edits");
        assert_eq!(out.len(), page.len());
        assert_eq!(out[0] & 0x7F, page[0] & 0x7F, "page code byte, minus the PS flag");
        assert_eq!(out[1], page[1], "page length");
        assert_eq!(out[5], page[5], "link size");
        assert_eq!(out[7], page[7], "host application code");
        assert_eq!(out[0x30], page[0x30], "vendor tail");
    }

    #[test]
    fn a_short_page_is_rejected_rather_than_indexed_past_its_end() {
        assert_eq!(apply(&[0x05, 0x02, 0x00], params()), Err(ModePageError::TooShort(3)));
        assert_eq!(apply(&[], params()), Err(ModePageError::TooShort(0)));
    }

    #[test]
    fn a_page_that_is_not_write_parameters_is_rejected() {
        let mut wrong = drive_page();
        wrong[0] = 0x2A; // caching page
        assert_eq!(apply(&wrong, params()), Err(ModePageError::WrongPage(0x2A)));
    }

    #[test]
    fn the_page_code_is_read_without_its_flag_bits() {
        // Page Set and Parameters Savable must not be mistaken for the code.
        let mut page = drive_page();
        page[0] = 0xC5;
        assert!(apply(&page, params()).is_ok());
    }
}
