//! MMC pieces the CD-TEXT write needs, kept pure and testable.
//!
//! Shared by every backend that drives a recorder itself: Windows, because
//! IMAPI2 has no CD-TEXT support and that path falls back to
//! `IDiscRecorder2Ex::SendCommand*`, and Linux, where `SG_IO` is the only way
//! in. Everything that can be decided without a drive — the cue sheet, the
//! Write Parameters mode page, the command blocks — lives here so it can be
//! checked against the specification rather than against a stack of coasters.
//!
//! **Mind the specification.** ANSI X3.304-1997 is MMC-1, and it predates
//! CD-TEXT entirely — it does not mention it once. Building the lead-in write
//! from that document is what produced the first round of discs whose CD-TEXT
//! no player could read. Anything CD-TEXT-shaped here follows MMC-3 (INCITS
//! 360-2002) and cdrdao's `GenericMMC`, which is where the working behaviour
//! was finally pinned down.

pub mod cue;
pub mod mode;
pub mod scsi;

use crate::model::BYTES_PER_AUDIO_SECTOR;

/// Operation code for `WRITE(10)`.
pub const OP_WRITE_10: u8 = 0x2A;

/// Operation code for `SEND CUE SHEET`.
pub const OP_SEND_CUE_SHEET: u8 = 0x5D;

/// Build a `WRITE(10)` command block.
///
/// `lba` is signed because the lead-in lives at negative addresses: CD-TEXT is
/// written from `-150 - lead_in_sectors` upwards, ahead of the pregap.
pub fn write_10_cdb(lba: i32, blocks: u16) -> [u8; 10] {
    let addr = lba as u32;
    [
        OP_WRITE_10,
        0,
        (addr >> 24) as u8,
        (addr >> 16) as u8,
        (addr >> 8) as u8,
        addr as u8,
        0,
        (blocks >> 8) as u8,
        blocks as u8,
        0,
    ]
}

/// Build a `SEND CUE SHEET` command block for a sheet of `len` bytes.
pub fn send_cue_sheet_cdb(len: u32) -> [u8; 10] {
    [
        OP_SEND_CUE_SHEET,
        0,
        0,
        0,
        0,
        0,
        (len >> 16) as u8,
        (len >> 8) as u8,
        len as u8,
        0,
    ]
}

/// Operation code for `READ DISC INFORMATION`.
pub const OP_READ_DISC_INFORMATION: u8 = 0x51;

/// Build a `READ DISC INFORMATION` command block for `len` bytes.
pub fn read_disc_information_cdb(len: u16) -> [u8; 10] {
    [
        OP_READ_DISC_INFORMATION,
        0,
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

/// Operation code for `SET CD SPEED`.
pub const OP_SET_CD_SPEED: u8 = 0xBB;

/// FFFFh in a `SET CD SPEED` field: "whatever your maximum is".
const SPEED_MAXIMUM: u16 = 0xFFFF;

/// Build a `SET CD SPEED` command block asking to burn at `write_kbps`.
///
/// MMC-3 (INCITS 360-2002) 6.35: twelve bytes, with the read speed big-endian
/// in bytes 2-3 and the **write** speed big-endian in bytes 4-5. Putting the
/// write speed in the read field is the easy mistake here, and it is a quiet
/// one: the drive accepts the command and burns at its own speed anyway.
///
/// Both fields are kilobytes per second — not sectors per second, and not an
/// "x" multiplier — so callers convert with `sectors_per_second_to_kbps`
/// first. Handing this a bare `4` for 4x asks for 4 kB/s, which is not a speed
/// any CD drive has.
///
/// The read speed stays at FFFFh because a burn reads nothing: pinning it would
/// only leave the drive crawling for whoever plays the disc next. Byte 1's
/// rotational-control field stays 00b — CLV/zone-CAV, the same choice the
/// IMAPI2 path makes with `SetWriteSpeed(.., false)`, and the safe one for
/// audio.
pub fn set_cd_speed_cdb(write_kbps: u16) -> [u8; 12] {
    [
        OP_SET_CD_SPEED,
        0,
        (SPEED_MAXIMUM >> 8) as u8,
        SPEED_MAXIMUM as u8,
        (write_kbps >> 8) as u8,
        write_kbps as u8,
        0,
        0,
        0,
        0,
        0,
        0,
    ]
}

/// A write speed in sectors per second, as `SET CD SPEED` wants it.
///
/// The rest of the burner counts speed in sectors per second, because that is
/// what a disc's length is measured in. The command counts kilobytes per
/// second, of 1000 bytes: 1x is 75 sectors of 2352 bytes, so 176.4 kB/s, which
/// rounds to 176.
///
/// A number that cannot be a write speed comes back as `None` rather than as a
/// field value, and the caller then sends nothing at all. Zero would ask a
/// drive to stop; anything past the 16-bit field would wrap into a
/// plausible-looking *slow* speed and burn an hour-long disc at 1x; and FFFFh
/// is the spec's "maximum" rather than a speed, so it is kept out of band too.
pub fn sectors_per_second_to_kbps(sectors_per_second: u32) -> Option<u16> {
    if sectors_per_second == 0 {
        return None;
    }
    // Integer arithmetic in 64 bits, rounded half up. This is a field in a
    // command block, and it is worth being able to say the number is exact.
    let bytes_per_second = u64::from(sectors_per_second) * BYTES_PER_AUDIO_SECTOR as u64;
    let kbps = (bytes_per_second + 500) / 1000;
    (kbps < u64::from(SPEED_MAXIMUM)).then_some(kbps as u16)
}

/// First LBA of the lead-in, given its length in sectors.
///
/// The pregap starts at −150 and the lead-in runs immediately before it, so a
/// lead-in of `lead_in_sectors` begins there and ends at −150.
pub fn lead_in_start_lba(lead_in_sectors: u32) -> i32 {
    -150 - (lead_in_sectors as i32)
}

/// How long this disc's lead-in is, in sectors.
///
/// A blank CD-R reports its lead-in start from ATIP, normally around 97
/// minutes; the lead-in then runs to 100:00:00, which is sector 450 000 — the
/// point the address wraps to zero. A disc reporting something implausibly
/// early gets the conventional one-minute fallback.
pub fn lead_in_sectors(lead_in_start: u32) -> u32 {
    /// 100:00:00 in sectors, where the lead-in ends.
    const LEAD_IN_END: u32 = 100 * 60 * 75;
    /// Below this the reported start is not credible.
    const PLAUSIBLE_FROM: u32 = 80 * 60 * 75;
    /// One minute, the conventional fallback.
    const FALLBACK: u32 = 60 * 75;

    if (PLAUSIBLE_FROM..LEAD_IN_END).contains(&lead_in_start) {
        LEAD_IN_END - lead_in_start
    } else {
        FALLBACK
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_10_encodes_a_positive_address_big_endian() {
        let cdb = write_10_cdb(0x0001_2345, 27);
        assert_eq!(cdb[0], OP_WRITE_10);
        assert_eq!(&cdb[2..6], &[0x00, 0x01, 0x23, 0x45]);
        assert_eq!(&cdb[7..9], &[0x00, 27]);
    }

    #[test]
    fn write_10_encodes_negative_lead_in_addresses_as_twos_complement() {
        // −150 is FFFFFF6A; the drive reads the field as a signed LBA.
        let cdb = write_10_cdb(-150, 1);
        assert_eq!(&cdb[2..6], &[0xFF, 0xFF, 0xFF, 0x6A]);
    }

    #[test]
    fn the_lead_in_runs_up_to_the_pregap() {
        assert_eq!(lead_in_start_lba(0), -150);
        assert_eq!(lead_in_start_lba(4500), -4650);
        // Whatever its length, it ends exactly where the pregap begins.
        for sectors in [1, 4500, 13_500] {
            assert_eq!(lead_in_start_lba(sectors) + sectors as i32, -150);
        }
    }

    #[test]
    fn lead_in_length_runs_from_the_discs_atip_start_to_the_wrap_point() {
        // A typical blank reports ~97:00:00; the lead-in runs to 100:00:00.
        let start = 97 * 60 * 75;
        assert_eq!(lead_in_sectors(start), 100 * 60 * 75 - start);
        assert_eq!(lead_in_sectors(start), 13_500);
    }

    #[test]
    fn an_implausible_lead_in_start_falls_back_to_one_minute() {
        assert_eq!(lead_in_sectors(0), 4500);
        assert_eq!(lead_in_sectors(1000), 4500);
        // At or past the wrap point is nonsense too.
        assert_eq!(lead_in_sectors(100 * 60 * 75), 4500);
    }

    #[test]
    fn read_disc_information_asks_for_the_length_it_was_given() {
        let cdb = read_disc_information_cdb(34);
        assert_eq!(cdb[0], OP_READ_DISC_INFORMATION);
        assert_eq!(&cdb[7..9], &[0x00, 34]);
    }

    #[test]
    fn send_cue_sheet_encodes_a_24_bit_length() {
        let cdb = send_cue_sheet_cdb(8 * 15);
        assert_eq!(cdb[0], OP_SEND_CUE_SHEET);
        assert_eq!(&cdb[6..9], &[0x00, 0x00, 120]);

        let big = send_cue_sheet_cdb(0x01_02_03);
        assert_eq!(&big[6..9], &[0x01, 0x02, 0x03]);
    }
}
