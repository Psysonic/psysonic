//! CRC-16 for CD-TEXT packs.
//!
//! Divisor `0x11021` (the CCITT polynomial), computed over the pack's first 16
//! bytes, then **inverted** and stored big-endian in bytes 16-17. The inversion
//! is the part everyone gets wrong: a pack whose CRC is left un-inverted is
//! accepted by some players and silently ignored by others, which is far worse
//! than a clean failure.

/// Polynomial in its 16-bit form (the implicit x^16 term is the shift-out).
const POLY: u16 = 0x1021;

/// CRC-16-CCITT over `bytes`, seeded at zero, MSB-first.
fn crc16(bytes: &[u8]) -> u16 {
    let mut crc: u16 = 0;
    for &byte in bytes {
        crc ^= u16::from(byte) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 {
                (crc << 1) ^ POLY
            } else {
                crc << 1
            };
        }
    }
    crc
}

/// CD-TEXT pack CRC: CRC-16-CCITT of the 16 header+data bytes, inverted.
///
/// Returned big-endian, ready to drop into pack bytes 16 and 17.
pub fn pack_crc(header_and_data: &[u8]) -> [u8; 2] {
    let crc = !crc16(header_and_data);
    [(crc >> 8) as u8, crc as u8]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_empty_message_crc_is_zero_before_inversion() {
        assert_eq!(crc16(&[]), 0x0000);
    }

    #[test]
    fn matches_the_ccitt_false_free_reference_vector() {
        // CRC-16/XMODEM (init 0x0000, poly 0x1021, no reflection) over "123456789"
        // is the standard published check value 0x31C3.
        assert_eq!(crc16(b"123456789"), 0x31C3);
    }

    #[test]
    fn the_pack_crc_is_the_inverted_residue_big_endian() {
        let residue = crc16(b"123456789");
        let expected = !residue;
        let bytes = pack_crc(b"123456789");
        assert_eq!(bytes, [(expected >> 8) as u8, expected as u8]);
        // Explicitly: inverted, not raw.
        assert_ne!(bytes, [(residue >> 8) as u8, residue as u8]);
    }

    #[test]
    fn appending_the_crc_makes_the_whole_pack_check_to_the_magic_residue() {
        // With an inverted CRC appended, running the CRC over the whole 18-byte
        // pack yields the constant 0x1D0F. This is the check a player performs,
        // so it is the property worth asserting.
        let mut pack = vec![0x80, 0x00, 0x00, 0x00];
        pack.extend_from_slice(b"Hello world!");
        let crc = pack_crc(&pack);
        pack.extend_from_slice(&crc);
        assert_eq!(pack.len(), 18);
        assert_eq!(crc16(&pack), 0x1D0F);
    }

    #[test]
    fn a_single_flipped_bit_changes_the_crc() {
        let mut pack = [0u8; 16];
        pack[0] = 0x80;
        let clean = pack_crc(&pack);
        pack[7] ^= 0x01;
        assert_ne!(pack_crc(&pack), clean);
    }
}
