use rodio::source::UniformSourceIterator;
use rodio::Source;

use super::*;
use crate::decode::test_support::{
    build_mono_pcm16_aiff, build_pcm16_wav, seekable_source, synthetic_wav_bytes,
};

#[test]
fn sized_decoder_constructs_from_synthetic_wav() {
    let wav = synthetic_wav_bytes(0.5);
    let decoder = SizedDecoder::new(wav, Some("wav"), false).expect("WAV decode setup");
    assert_eq!(decoder.spec.rate(), 44_100);
    assert_eq!(decoder.spec.channels().count(), 1);
}

#[test]
fn sized_decoder_returns_err_for_garbage_input() {
    let result = SizedDecoder::new(vec![0x00u8; 64], None, false);
    assert!(result.is_err());
}

#[test]
fn an_empty_buffer_reports_a_whole_frame_so_the_channels_stay_paired() {
    // The span an empty buffer reports is handed to rodio's resampler, which
    // takes `channels` samples for its current frame and `channels` for the
    // next one (`conversions/sample_rate.rs`), and to the channel converter,
    // which counts a frame's samples from the start of every span. Reporting
    // half a frame is only harmless while that converter is pass-through.
    //
    // Measured, because the obvious failure does not happen: a partial frame
    // is *not* dropped on re-bootstrap — `SampleRateConverter::next` drains
    // `current_span` when it cannot interpolate — and no production call site
    // asks for a channel count other than the source's own, so nothing here
    // audibly breaks today. This test pins the frame alignment rather than
    // that pair of coincidences.
    //
    // The empty buffer itself is reached by seeking near the end:
    // `refine_position` hits EOF while refining and clears it.
    const LEFT: i16 = 12_000;
    const RIGHT: i16 = -12_000;
    let frames = 4_096;
    let mut interleaved = Vec::with_capacity(frames * 2);
    for _ in 0..frames {
        interleaved.push(LEFT);
        interleaved.push(RIGHT);
    }
    let wav = build_pcm16_wav(&interleaved, 44_100, 2);

    let mut decoder = SizedDecoder::new(wav, Some("wav"), false).expect("stereo WAV decode");
    assert_eq!(decoder.channels().get(), 2, "fixture must be stereo");

    // The state `refine_position` leaves behind at EOF.
    decoder.buffer.clear();
    decoder.current_frame_offset = 0;

    let span = decoder
        .current_span_len()
        .expect("an empty buffer must not report an infinite span");
    assert_eq!(
        span % decoder.channels().get() as usize,
        0,
        "a span that is not a whole number of frames shifts the interleave phase"
    );

    // 44.1 kHz source on a 48 kHz device: the rate converter is in the chain,
    // which is the only case where the span is consumed this way.
    let resampled = UniformSourceIterator::new(
        decoder,
        std::num::NonZeroU16::new(2).unwrap(),
        std::num::NonZeroU32::new(48_000).unwrap(),
    );
    let out: Vec<f32> = resampled.take(64).collect();
    assert!(!out.is_empty(), "resampled source must still produce audio");

    for (i, s) in out.iter().enumerate() {
        let expected_left = i % 2 == 0;
        assert_eq!(
            *s > 0.0,
            expected_left,
            "sample {i} landed on the wrong channel: the interleave phase shifted"
        );
    }
}

#[test]
fn sized_decoder_uses_format_hint_when_provided() {
    let wav = synthetic_wav_bytes(0.3);
    let _decoder = SizedDecoder::new(wav, Some("wav"), true).expect("WAV decode with hi-res");
}

// ── new_streaming + ProbeSeekGate ────────────────────────────────────────

#[test]
fn new_streaming_constructs_from_synthetic_wav() {
    let wav = synthetic_wav_bytes(0.5);
    let decoder =
        SizedDecoder::new_streaming(seekable_source(wav), Some("wav"), "test-stream", true, None)
            .expect("streaming WAV decode setup");
    assert_eq!(decoder.spec.rate(), 44_100);
    assert_eq!(decoder.spec.channels().count(), 1);
    // A finite, seekable source reports the duration it will actually deliver,
    // so consumers scheduling from it (crossfade) stay in step with the source.
    assert!(
        decoder.total_duration.is_some(),
        "a random-access source has a real frame count and must report it"
    );

    // An open-ended one does not: its frame count cannot be trusted.
    let wav = synthetic_wav_bytes(0.5);
    let live = SizedDecoder::new_streaming(
        seekable_source(wav),
        Some("wav"),
        "test-stream",
        false,
        None,
    )
    .expect("streaming WAV decode setup");
    assert!(
        live.total_duration.is_none(),
        "radio and the non-seekable fallback must not claim a duration"
    );
}

#[test]
fn new_streaming_decodes_synthetic_aiff() {
    let aiff = build_mono_pcm16_aiff(&[16_384; 64], b"AIFF", false);
    let mut decoder = SizedDecoder::new_streaming(
        seekable_source(aiff),
        Some("aiff"),
        "test-stream",
        true,
        None,
    )
    .expect("streaming AIFF decode setup");
    assert_eq!(decoder.spec.rate(), 44_100);
    assert_eq!(decoder.spec.channels().count(), 1);
    let sample = decoder.next().expect("AIFF should yield decoded PCM");
    assert!((sample - 0.5).abs() < 0.01, "decoded sample was {sample}");
}

#[test]
fn random_access_stream_decodes_aiff_with_sound_before_common() {
    let aiff = build_mono_pcm16_aiff(&[16_384; 64], b"AIFF", true);
    let mut decoder =
        SizedDecoder::new_streaming(seekable_source(aiff), Some("aif"), "hot-cache", true, None)
            .expect("seekable AIFF should allow chunks in either order");
    assert!(decoder.next().is_some());
}

#[test]
fn hintless_sized_decoder_decodes_aiff_with_sound_before_common() {
    let aiff = build_mono_pcm16_aiff(&[16_384; 64], b"AIFF", true);
    let mut decoder = SizedDecoder::new(aiff, None, false)
        .expect("hintless in-memory AIFF should be sniffed before the seek gate");
    assert!(decoder.next().is_some());
}

#[test]
fn misleading_hint_does_not_hide_seekability_for_sniffed_aiff() {
    let aiff = build_mono_pcm16_aiff(&[16_384; 64], b"AIFF", true);
    let mut decoder = SizedDecoder::new(aiff, Some("view"), false)
        .expect("AIFF magic should control the seek gate despite a misleading URL tail");
    assert!(decoder.next().is_some());
}

#[test]
fn sized_decoder_decodes_uncompressed_aifc() {
    let aifc = build_mono_pcm16_aiff(&[16_384; 64], b"AIFC", false);
    let mut decoder = SizedDecoder::new(aifc, Some("aifc"), false).expect("AIFC decode setup");
    let sample = decoder.next().expect("AIFC should yield decoded PCM");
    assert!((sample - 0.5).abs() < 0.01, "decoded sample was {sample}");
}

#[test]
fn new_streaming_returns_err_for_garbage_input() {
    let result = SizedDecoder::new_streaming(
        seekable_source(vec![0x00u8; 64]),
        None,
        "test-stream",
        true,
        None,
    );
    assert!(result.is_err());
}

#[test]
fn extensible_wav_layout_is_verified_equally_for_bytes_and_streaming() {
    use crate::decode::test_support::extensible_wav;
    use crate::decode::{AudioFormatEvent, AudioFormatIdentity};

    let wav = extensible_wav(6, 0x3f, 64);
    let bytes = SizedDecoder::new(wav.clone(), Some("wav"), false).unwrap();
    let stream =
        SizedDecoder::new_streaming(seekable_source(wav), Some("wav"), "layout-test", true, None)
            .unwrap();
    for mut decoder in [bytes, stream] {
        let json = serde_json::to_value(AudioFormatEvent::from_info(
            decoder.codec_info(),
            AudioFormatIdentity::default(),
        ))
        .unwrap();
        assert_eq!(json["channels"], 6);
        assert_eq!(
            json["channelLayout"],
            serde_json::json!({
                "mainChannels": 5, "lfeChannels": 1, "provenance": "wav-mask",
            })
        );
        assert_eq!(decoder.channels().get(), 6);
        let samples: Vec<_> = decoder.by_ref().take(48).collect();
        assert_eq!(
            samples,
            vec![0.25; 48],
            "display evidence must not change PCM"
        );
    }
}

#[test]
fn repaired_wav_masks_and_plain_wav_keep_count_without_verified_layout() {
    use crate::decode::test_support::extensible_wav;
    for wav in [
        extensible_wav(6, 0, 64),
        extensible_wav(6, 3, 64),
        build_pcm16_wav(&[8192; 384], 48_000, 6),
    ] {
        let bytes = SizedDecoder::new(wav.clone(), Some("wav"), false).unwrap();
        let stream = SizedDecoder::new_streaming(
            seekable_source(wav),
            Some("wav"),
            "unverified-layout",
            true,
            None,
        )
        .unwrap();
        for decoder in [bytes, stream] {
            assert_eq!(decoder.codec_info().channels, Some(6));
            assert!(decoder.codec_info().channel_layout.is_none());
        }
    }
}

#[test]
fn empty_or_truncated_wav_never_acquires_layout_without_decoded_audio() {
    use crate::decode::test_support::extensible_wav;
    for frames in [0, 64] {
        let mut wav = extensible_wav(6, 0x3f, frames);
        wav.truncate(68);
        let bytes = SizedDecoder::new(wav.clone(), Some("wav"), false);
        let stream = SizedDecoder::new_streaming(
            seekable_source(wav),
            Some("wav"),
            "empty-layout",
            true,
            None,
        );
        // Preserve the constructors' existing error/empty-EOF distinction.
        for decoder in [bytes, stream].into_iter().flatten() {
            assert!(decoder.buffer.is_empty());
            assert!(decoder.codec_info().channel_layout.is_none());
        }
    }
}

#[test]
fn repository_flac_fixture_has_the_same_native_authority_in_both_paths() {
    let flac = include_bytes!("../../../fixtures/five_one_sine.flac").to_vec();
    let bytes = SizedDecoder::new(flac.clone(), Some("flac"), false).unwrap();
    let stream = SizedDecoder::new_streaming(
        seekable_source(flac),
        Some("flac"),
        "flac-layout",
        true,
        None,
    )
    .unwrap();
    for decoder in [bytes, stream] {
        let json = serde_json::to_value(crate::decode::AudioFormatEvent::from_info(
            decoder.codec_info(),
            crate::decode::AudioFormatIdentity::default(),
        ))
        .unwrap();
        assert_eq!(json["channels"], 6);
        assert_eq!(
            json["channelLayout"],
            serde_json::json!({
                "mainChannels": 5, "lfeChannels": 1, "provenance": "flac-mask",
            })
        );
    }
}
