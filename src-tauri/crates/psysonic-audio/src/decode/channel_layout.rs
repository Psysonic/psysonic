//! Display-only authority, independent of decoder-inferred/repaired positions.
//! RFC 9639 §§8.6.2/9.1.3, Vorbis I §4.3.9, and original extensible RIFF masks.

pub(super) const MAX_CAPTURE_BYTES: usize = 1024 * 1024;
const MAX_ITEMS: usize = 4096;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum LayoutProvenance {
    VorbisMapping,
    FlacDefault,
    FlacMask,
    WavMask,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifiedChannelLayout {
    main_channels: u16,
    lfe_channels: u16,
    provenance: LayoutProvenance,
}

/// Called only at initialization, with a nonempty decoded buffer's count.
/// Header evidence is the bounded contiguous prefix observed by ordinary reads.
pub(super) fn verify_channel_layout(
    codec: &str,
    codec_channels: Option<u16>,
    decoded_channels: Option<usize>,
    prefix: &[u8],
) -> Option<VerifiedChannelLayout> {
    let channels = codec_channels?;
    if !(1..=11).contains(&channels) || decoded_channels? != usize::from(channels) {
        return None;
    }
    let prefix = &prefix[..prefix.len().min(MAX_CAPTURE_BYTES)];
    match codec {
        "vorbis" => codec_defined(channels, LayoutProvenance::VorbisMapping),
        "flac" => flac_layout(prefix, channels),
        name if name.starts_with("pcm") => wav_layout(prefix, channels),
        _ => None,
    }
}

fn codec_defined(channels: u16, provenance: LayoutProvenance) -> Option<VerifiedChannelLayout> {
    // These two codecs define the same grouping for mapping 0 / native defaults.
    // This table must never be used as a generic count-to-layout fallback.
    let lfe_channels = match channels {
        1..=5 => 0,
        6..=8 => 1,
        _ => return None,
    };
    Some(VerifiedChannelLayout {
        main_channels: channels - lfe_channels,
        lfe_channels,
        provenance,
    })
}

fn masked(mask: u32, channels: u16, provenance: LayoutProvenance) -> Option<VerifiedChannelLayout> {
    // Only WAVE floor speakers (bits 0..10); no heights, discrete or partial maps.
    if mask == 0 || mask & !0x7ff != 0 || mask.count_ones() != u32::from(channels) {
        return None;
    }
    let lfe_channels = u16::from(mask & 8 != 0);
    (channels > lfe_channels).then_some(VerifiedChannelLayout {
        main_channels: channels - lfe_channels,
        lfe_channels,
        provenance,
    })
}

fn le16(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        bytes.get(at..at.checked_add(2)?)?.try_into().ok()?,
    ))
}

fn le32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        bytes.get(at..at.checked_add(4)?)?.try_into().ok()?,
    ))
}

fn be24(bytes: &[u8]) -> u32 {
    (u32::from(bytes[0]) << 16) | (u32::from(bytes[1]) << 8) | u32::from(bytes[2])
}

fn flac_layout(bytes: &[u8], channels: u16) -> Option<VerifiedChannelLayout> {
    if bytes.get(..4)? != b"fLaC" {
        return None;
    }
    let mut at = 4usize;
    let mut comment_seen = false;
    let mut mask = None;
    for index in 0..MAX_ITEMS {
        let header = bytes.get(at..at.checked_add(4)?)?;
        let kind = header[0] & 0x7f;
        let len = be24(&header[1..]) as usize;
        at = at.checked_add(4)?;
        let end = at.checked_add(len)?;
        let block = bytes.get(at..end)?;
        match kind {
            0 if index == 0 => {
                if !valid_streaminfo(block, channels) {
                    return None;
                }
            }
            0 => return None,
            _ if index == 0 => return None,
            1 if block.iter().any(|&b| b != 0) => return None,
            2 if len < 4 => return None,
            3 if !len.is_multiple_of(18) => return None,
            4 => {
                if comment_seen {
                    return None;
                }
                comment_seen = true;
                mask = comment_mask(block)?;
            }
            5 if len < 396 => return None,
            7..=127 => return None, // Reserved metadata could introduce unknown semantics.
            _ => {}
        }
        at = end;
        if header[0] & 0x80 != 0 {
            return match mask {
                Some(mask) => masked(mask, channels, LayoutProvenance::FlacMask),
                None => codec_defined(channels, LayoutProvenance::FlacDefault),
            };
        }
    }
    None
}

fn valid_streaminfo(block: &[u8], channels: u16) -> bool {
    if block.len() != 34 {
        return false;
    }
    let min = u16::from_be_bytes([block[0], block[1]]);
    let max = u16::from_be_bytes([block[2], block[3]]);
    let min_frame = be24(&block[4..7]);
    let max_frame = be24(&block[7..10]);
    let rate = be24(&block[10..13]) >> 4;
    let count = u16::from((block[12] >> 1) & 7) + 1;
    let bits = ((block[12] & 1) << 4 | block[13] >> 4) + 1;
    min >= 16
        && max >= min
        && rate > 0
        && count == channels
        && bits >= 4
        && (min_frame == 0 || max_frame == 0 || max_frame >= min_frame)
}

/// Some(None) means a complete valid comment block without an override.
fn comment_mask(block: &[u8]) -> Option<Option<u32>> {
    let mut at = 0usize;
    let vendor = length_prefixed(block, &mut at)?;
    std::str::from_utf8(vendor).ok()?;
    let count = le32(block, at)? as usize;
    at = at.checked_add(4)?;
    if count > MAX_ITEMS {
        return None;
    }
    let mut mask = None;
    for _ in 0..count {
        let field = length_prefixed(block, &mut at)?;
        std::str::from_utf8(field).ok()?;
        let equal = field.iter().position(|&b| b == b'=')?;
        let (name, value) = (&field[..equal], &field[equal + 1..]);
        if name.is_empty() || name.iter().any(|b| !(0x20..=0x7e).contains(b)) {
            return None;
        }
        if name.eq_ignore_ascii_case(b"WAVEFORMATEXTENSIBLE_CHANNEL_MASK") {
            if mask.is_some() {
                return None; // Even identical duplicates are ambiguous evidence.
            }
            if value.len() < 3 || !value[..2].eq_ignore_ascii_case(b"0x") {
                return None;
            }
            let mut parsed = 0u32;
            for digit in &value[2..] {
                let hex = (*digit as char).to_digit(16)?;
                parsed = parsed.checked_mul(16)?.checked_add(hex)?;
            }
            mask = Some(parsed);
        }
    }
    (at == block.len()).then_some(mask)
}

fn length_prefixed<'a>(bytes: &'a [u8], at: &mut usize) -> Option<&'a [u8]> {
    let len = le32(bytes, *at)? as usize;
    *at = at.checked_add(4)?;
    let end = at.checked_add(len)?;
    let value = bytes.get(*at..end)?;
    *at = end;
    Some(value)
}

fn wav_layout(bytes: &[u8], channels: u16) -> Option<VerifiedChannelLayout> {
    if bytes.get(..4)? != b"RIFF" || bytes.get(8..12)? != b"WAVE" {
        return None;
    }
    let riff_end = usize::try_from(le32(bytes, 4)?).ok()?.checked_add(8)?;
    let mut at = 12usize;
    let mut format = None;
    for _ in 0..MAX_ITEMS {
        let start = at.checked_add(8)?;
        if start > riff_end {
            return None;
        }
        let header = bytes.get(at..start)?;
        let len = le32(header, 4)? as usize;
        let end = start.checked_add(len)?;
        let next = end.checked_add(len % 2)?;
        if next > riff_end {
            return None;
        }
        match &header[..4] {
            b"fmt " => {
                if format.is_some() {
                    return None;
                }
                format = Some(wav_format(bytes.get(start..end)?, channels)?);
            }
            b"data" => {
                let (mask, align) = format?;
                if len == 0 || !len.is_multiple_of(usize::from(align)) {
                    return None;
                }
                return masked(mask, channels, LayoutProvenance::WavMask);
            }
            _ => {}
        }
        // Require the entire skipped chunk and its padding to have been observed.
        bytes.get(start..next)?;
        at = next;
    }
    None
}

fn wav_format(block: &[u8], channels: u16) -> Option<(u32, u16)> {
    if block.len() != 40
        || le16(block, 0)? != 0xfffe
        || le16(block, 2)? != channels
        || le16(block, 16)? != 22
    {
        return None;
    }
    let guid = block.get(24..40)?;
    if guid[1..]
        != [
            0, 0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71,
        ]
        || !matches!(guid[0], 1 | 3)
    {
        return None;
    }
    let rate = le32(block, 4)?;
    let bits = le16(block, 14)?;
    let valid_bits = le16(block, 18)?;
    let valid_depth = if guid[0] == 1 {
        matches!(bits, 8 | 16 | 24 | 32) && valid_bits > 0 && valid_bits <= bits
    } else {
        matches!(bits, 32 | 64) && valid_bits == bits
    };
    let align = channels.checked_mul(bits / 8)?;
    if !valid_depth
        || rate == 0
        || le16(block, 12)? != align
        || le32(block, 8)? != rate.checked_mul(u32::from(align))?
    {
        return None;
    }
    Some((le32(block, 20)?, align))
}

#[cfg(test)]
#[path = "tests/channel_layout_unit.rs"]
mod tests;
