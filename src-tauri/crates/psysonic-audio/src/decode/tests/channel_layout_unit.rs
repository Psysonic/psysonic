use super::*;
use crate::decode::test_support::{build_pcm16_wav, extensible_wav};

fn verify(codec: &str, channels: u16, bytes: &[u8]) -> Option<VerifiedChannelLayout> {
    verify_channel_layout(codec, Some(channels), Some(channels as usize), bytes)
}

fn expected(main: u16, lfe: u16, provenance: LayoutProvenance) -> Option<VerifiedChannelLayout> {
    Some(VerifiedChannelLayout {
        main_channels: main,
        lfe_channels: lfe,
        provenance,
    })
}

fn streaminfo(channels: u16) -> Vec<u8> {
    let mut block = vec![0; 34];
    block[..4].copy_from_slice(&[0, 16, 0, 16]);
    let packed = (48_000u64 << 44) | (u64::from(channels - 1) << 41) | (15 << 36) | 64;
    block[10..18].copy_from_slice(&packed.to_be_bytes());
    block
}

fn flac(channels: u16, blocks: Vec<(u8, Vec<u8>)>) -> Vec<u8> {
    let mut all = vec![(0, streaminfo(channels))];
    all.extend(blocks);
    let count = all.len();
    let mut out = b"fLaC".to_vec();
    for (index, (kind, block)) in all.into_iter().enumerate() {
        out.push(kind | if index + 1 == count { 0x80 } else { 0 });
        out.extend_from_slice(&(block.len() as u32).to_be_bytes()[1..]);
        out.extend_from_slice(&block);
    }
    out
}

fn comments(fields: &[&[u8]]) -> Vec<u8> {
    let mut out = 4u32.to_le_bytes().to_vec();
    out.extend_from_slice(b"test");
    out.extend_from_slice(&(fields.len() as u32).to_le_bytes());
    for field in fields {
        out.extend_from_slice(&(field.len() as u32).to_le_bytes());
        out.extend_from_slice(field);
    }
    out
}

#[test]
fn codec_defaults_are_only_for_audited_flac_and_vorbis_assignments() {
    for channels in 1..=8 {
        let lfe = u16::from(channels >= 6);
        assert_eq!(
            verify("vorbis", channels, &[]),
            expected(channels - lfe, lfe, LayoutProvenance::VorbisMapping)
        );
        assert_eq!(
            verify("flac", channels, &flac(channels, vec![])),
            expected(channels - lfe, lfe, LayoutProvenance::FlacDefault)
        );
    }
    for codec in ["mp3", "aac", "alac", "opus", "pcm_s16le", "?"] {
        assert_eq!(verify(codec, 6, &flac(6, vec![])), None, "{codec}");
    }
    assert_eq!(verify("flac", 6, b"OggSfLaC"), None);
    assert_eq!(verify("vorbis", 9, &[]), None);
}

#[test]
fn decoded_audio_and_both_counts_are_required_without_changing_numeric_channels() {
    let bytes = flac(6, vec![]);
    for (codec_count, decoded) in [
        (None, Some(6)),
        (Some(6), None),
        (Some(6), Some(0)),
        (Some(6), Some(2)),
        (Some(0), Some(0)),
        (Some(12), Some(12)),
    ] {
        assert_eq!(
            verify_channel_layout("flac", codec_count, decoded, &bytes),
            None
        );
    }
    assert_eq!(verify("flac", 2, &bytes), None);
}

#[test]
fn flac_requires_the_whole_metadata_chain_before_using_defaults() {
    let bytes = flac(6, vec![(1, vec![0; 19]), (4, comments(&[b"ARTIST=test"]))]);
    for end in 0..bytes.len() {
        assert_eq!(verify("flac", 6, &bytes[..end]), None, "prefix {end}");
    }
    assert_eq!(
        verify("flac", 6, &bytes),
        expected(5, 1, LayoutProvenance::FlacDefault)
    );
    let mut incomplete = bytes.clone();
    incomplete[4 + 38 + 23] &= 0x7f;
    assert_eq!(verify("flac", 6, &incomplete), None);
}

#[test]
fn flac_late_case_insensitive_padded_override_is_authoritative() {
    let bytes = flac(
        6,
        vec![
            (1, vec![0; 17]),
            (
                4,
                comments(&[
                    b"TITLE=not a channel mask",
                    b"waveformatextensible_channel_mask=0X0000000000000707",
                ]),
            ),
        ],
    );
    assert_eq!(
        verify("flac", 6, &bytes),
        expected(6, 0, LayoutProvenance::FlacMask)
    );
    let mask = b"WAVEFORMATEXTENSIBLE_CHANNEL_MASK=0x60f";
    assert_eq!(
        verify("flac", 6, &flac(6, vec![(4, comments(&[mask]))])),
        expected(5, 1, LayoutProvenance::FlacMask)
    );
}

#[test]
fn flac_invalid_partial_custom_and_duplicate_overrides_fail_closed() {
    for value in [
        "0x0",
        "0x7",
        "0x83f",
        "0x10000003f",
        "0x",
        "3f",
        "0x3g",
        " 0x3f",
        "0x3f ",
        "-0x3f",
    ] {
        let field = format!("WAVEFORMATEXTENSIBLE_CHANNEL_MASK={value}");
        assert_eq!(
            verify(
                "flac",
                6,
                &flac(6, vec![(4, comments(&[field.as_bytes()]))])
            ),
            None,
            "{value}"
        );
    }
    let field = b"WAVEFORMATEXTENSIBLE_CHANNEL_MASK=0x3f";
    for other in [field.as_slice(), b"WAVEFORMATEXTENSIBLE_CHANNEL_MASK=0x707"] {
        assert_eq!(
            verify("flac", 6, &flac(6, vec![(4, comments(&[field, other]))])),
            None
        );
    }
    assert_eq!(
        verify(
            "flac",
            6,
            &flac(6, vec![(4, comments(&[])), (4, comments(&[field]))])
        ),
        None
    );
    // A single LFE cannot be displayed as a conventional main-speaker grouping.
    assert_eq!(
        verify(
            "flac",
            1,
            &flac(
                1,
                vec![(4, comments(&[b"WAVEFORMATEXTENSIBLE_CHANNEL_MASK=0x0008"]))]
            )
        ),
        None
    );
}

#[test]
fn flac_comments_are_structural_utf8_fields_not_arbitrary_byte_matches() {
    for field in [
        b"missing-equals".as_slice(),
        b"=empty-name",
        b"bad\x01key=x",
        b"TITLE=\xff",
    ] {
        assert_eq!(
            verify("flac", 6, &flac(6, vec![(4, comments(&[field]))])),
            None
        );
    }
    let mut block = comments(&[]);
    block.push(1); // FLAC does not use the Vorbis framing bit.
    assert_eq!(verify("flac", 6, &flac(6, vec![(4, block)])), None);
    let mut block = comments(&[b"TITLE=test"]);
    block[12..16].copy_from_slice(&u32::MAX.to_le_bytes());
    assert_eq!(verify("flac", 6, &flac(6, vec![(4, block)])), None);
    let block = comments(&[b"TITLE=WAVEFORMATEXTENSIBLE_CHANNEL_MASK=0x0"]);
    assert_eq!(
        verify("flac", 6, &flac(6, vec![(4, block)])),
        expected(5, 1, LayoutProvenance::FlacDefault)
    );
}

#[test]
fn flac_streaminfo_and_block_envelopes_are_validated_with_bounded_work() {
    for (offset, value) in [(4, 1), (7, 33), (9, 0), (11, 0), (20, 0), (21, 0)] {
        let mut bytes = flac(6, vec![]);
        bytes[offset] = value;
        assert_eq!(verify("flac", 6, &bytes), None, "offset {offset}");
    }
    for blocks in [
        vec![(0, streaminfo(6))],
        vec![(127, vec![])],
        vec![(7, vec![])],
        vec![(1, vec![1])],
        vec![(2, vec![])],
        vec![(3, vec![0])],
    ] {
        assert_eq!(verify("flac", 6, &flac(6, blocks)), None);
    }
    let large = flac(6, vec![(1, vec![0; MAX_CAPTURE_BYTES])]);
    assert_eq!(verify("flac", 6, &large), None);
    let many = flac(6, vec![(1, vec![]); MAX_ITEMS]);
    assert_eq!(verify("flac", 6, &many), None);
    let many_comments = comments(&vec![b"A=B".as_slice(); MAX_ITEMS + 1]);
    assert_eq!(verify("flac", 6, &flac(6, vec![(4, many_comments)])), None);
}

#[test]
fn wav_original_masks_preserve_distinct_conventional_groupings() {
    for (channels, mask, main, lfe) in [
        (6, 0x3f, 5, 1),
        (6, 0x60f, 5, 1),
        (6, 0x707, 6, 0),
        (4, 0xf, 3, 1),
        (4, 0x33, 4, 0),
        (11, 0x7ff, 10, 1),
    ] {
        let wav = extensible_wav(channels, mask, 4);
        // Only the header must have been observed, not the entire PCM payload.
        assert_eq!(
            verify("pcm_s16le", channels, &wav[..68]),
            expected(main, lfe, LayoutProvenance::WavMask)
        );
    }
    assert_eq!(
        verify("pcm_s16le", 6, &build_pcm16_wav(&[0; 48], 48_000, 6)),
        None
    );
}

#[test]
fn wav_masks_are_not_repaired_or_guessed() {
    for (channels, mask) in [(6, 0), (6, 7), (6, 0x83b), (1, 8), (6, u32::MAX)] {
        assert_eq!(
            verify("pcm_s16le", channels, &extensible_wav(channels, mask, 4)),
            None
        );
    }
    assert_eq!(verify("pcm_s16le", 2, &extensible_wav(6, 0x3f, 4)), None);
    for marker in [b"RIFX", b"RF64", b"riff"] {
        let mut wav = extensible_wav(6, 0x3f, 4);
        wav[..4].copy_from_slice(marker);
        assert_eq!(verify("pcm_s16le", 6, &wav), None);
    }
}

#[test]
fn wav_rejects_invalid_guid_extension_depth_rate_and_chunk_bounds() {
    for (offset, value) in [
        (44, 2),
        (45, 1),
        (59, 0),
        (36, 21),
        (38, 0),
        (32, 0),
        (24, 0),
        (29, 0),
    ] {
        let mut wav = extensible_wav(6, 0x3f, 4);
        wav[offset] = value;
        assert_eq!(verify("pcm_s16le", 6, &wav), None, "offset {offset}");
    }
    for (offset, value) in [
        (4, 16),
        (16, u32::MAX),
        (64, u32::MAX),
        (24, u32::MAX),
        (64, 1),
        (64, 0),
    ] {
        let mut wav = extensible_wav(6, 0x3f, 4);
        wav[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
        assert_eq!(
            verify("pcm_s16le", 6, &wav),
            None,
            "offset {offset}, {value}"
        );
    }
    let wav = extensible_wav(6, 0x3f, 4);
    for end in 0..68 {
        assert_eq!(verify("pcm_s16le", 6, &wav[..end]), None);
    }
}

#[test]
fn wav_skipped_chunks_require_observed_padding_and_no_duplicate_fmt() {
    let wav = extensible_wav(6, 0x3f, 4);
    let mut padded = wav[..60].to_vec();
    padded.extend_from_slice(b"JUNK\x01\0\0\0x\0");
    padded.extend_from_slice(&wav[60..]);
    let size = (padded.len() - 8) as u32;
    padded[4..8].copy_from_slice(&size.to_le_bytes());
    assert_eq!(
        verify("pcm_s16le", 6, &padded),
        expected(5, 1, LayoutProvenance::WavMask)
    );
    padded.remove(69);
    assert_eq!(verify("pcm_s16le", 6, &padded), None);
    let mut duplicate = wav[..60].to_vec();
    duplicate.extend_from_slice(&wav[12..]);
    let size = (duplicate.len() - 8) as u32;
    duplicate[4..8].copy_from_slice(&size.to_le_bytes());
    assert_eq!(verify("pcm_s16le", 6, &duplicate), None);
}

#[test]
fn extensible_float_guid_is_supported_but_not_custom_subformats() {
    let mut wav = extensible_wav(6, 0x60f, 4);
    wav[44] = 3;
    wav[34..36].copy_from_slice(&32u16.to_le_bytes());
    wav[38..40].copy_from_slice(&32u16.to_le_bytes());
    wav[32..34].copy_from_slice(&24u16.to_le_bytes());
    wav[28..32].copy_from_slice(&(48_000u32 * 24).to_le_bytes());
    assert_eq!(
        verify("pcm_f32le", 6, &wav),
        expected(5, 1, LayoutProvenance::WavMask)
    );
    wav[38..40].copy_from_slice(&24u16.to_le_bytes());
    assert_eq!(verify("pcm_f32le", 6, &wav), None);
}
