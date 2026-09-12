use super::*;

fn assert_format_replays_after_eof(data: &[u8]) {
    let mss = MediaSourceStream::new(
        seekable_source(data.to_vec()),
        MediaSourceStreamOptions::default(),
    );
    let mut hint = Hint::new();
    hint.with_extension("m4a");
    let mut format = symphonia::default::get_probe()
        .probe(
            &hint,
            mss,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .expect("M4A fixture must probe");
    let track_id = format.tracks()[0].id;

    let drain = |format: &mut Box<dyn symphonia::core::formats::FormatReader>| {
        let mut packets = 0usize;
        loop {
            match format.next_packet() {
                Ok(Some(packet)) => {
                    if packet.track_id == track_id {
                        packets += 1;
                    }
                }
                Ok(None) => return packets,
                Err(error) => panic!("M4A packet pass failed: {error}"),
            }
        }
    };

    let first_pass = drain(&mut format);
    assert!(first_pass > 0, "M4A fixture must yield audio packets");
    for _ in 0..3 {
        assert!(
            format
                .next_packet()
                .expect("repeated EOF must not fail")
                .is_none(),
            "repeated EOF must stay at EOF"
        );
    }

    format
        .seek(
            symphonia::core::formats::SeekMode::Accurate,
            symphonia::core::formats::SeekTo::Time {
                time: symphonia::core::units::Time::ZERO,
                track_id: Some(track_id),
            },
        )
        .expect("seek after EOF must succeed");
    let replay = drain(&mut format);
    assert_eq!(replay, first_pass, "seek replay must yield every packet");
}

fn assert_decoder_replays_after_eof(mut decoder: SizedDecoder) {
    let first_pass = decoder.by_ref().count();
    assert!(first_pass > 0, "M4A decoder must yield samples");
    decoder
        .try_seek(Duration::ZERO)
        .expect("decoder seek after EOF must succeed");
    let replay = decoder.by_ref().count();
    assert_eq!(replay, first_pass, "decoder replay must yield every sample");
}

#[test]
fn isomp4_seek_after_eof_preserves_atom_boundaries() {
    for data in [
        ISOMP4_SEEK_NORMAL_M4A.to_vec(),
        ISOMP4_SEEK_FRAGMENTED_M4A.to_vec(),
        fragmented_m4a_with_padded_mdat(),
    ] {
        assert_format_replays_after_eof(&data);
    }
}

#[test]
fn isomp4_seek_after_eof_works_for_bytes_and_seekable_streams() {
    assert_decoder_replays_after_eof(
        SizedDecoder::new(ISOMP4_SEEK_NORMAL_M4A.to_vec(), Some("m4a"), false)
            .expect("M4A bytes must decode"),
    );
    assert_decoder_replays_after_eof(
        SizedDecoder::new_streaming(
            seekable_source(fragmented_m4a_with_padded_mdat()),
            Some("m4a"),
            "test-stream",
            true,
            None,
        )
        .expect("seekable M4A stream must decode"),
    );
}

#[test]
fn a_read_failure_before_the_demuxer_moves_stays_a_true_no_op() {
    // The failing half: the demuxer cannot complete its own seek reads, so
    // nothing moved and the previous position is still valid. The stale buffer
    // has to survive — clearing it here would silence audio that is still
    // correct, and the layers above keep their old counter on `Err`.
    let (ok, before, after) = seek_with_read_failure_after(0);
    assert!(
        !ok,
        "a seek that never moved the demuxer must report failure"
    );
    assert_eq!(
        before, after,
        "a no-op seek must leave the decoded buffer alone"
    );

    // The counter-check: granting a single read pulls the whole 4.6 KB fixture
    // into the MediaSourceStream buffer, so refinement reads nothing further and
    // cannot fail. Between "seek fails" and "everything succeeds" there is no
    // window — which is why a failure *after* the demuxer moved has no fixture
    // test, and is left alone here rather than fixed blind.
    let (ok, _, after) = seek_with_read_failure_after(1);
    assert!(ok, "one granted read must let the whole seek through");
    assert_eq!(
        after, 1152,
        "a landed seek installs a freshly decoded packet"
    );
}

#[test]
fn packet_dur_carries_the_untrimmed_block_length() {
    // `refine_position` walks packets by `packet.dur` and then subtracts
    // `packet.trim_start` from what is left. That is only correct while `dur`
    // is the *untrimmed* block length.
    //
    // Symphonia 0.6 documents the opposite: `Packet::dur` is "the duration of
    // all valid frames … excludes any delay or padding", and `block_dur()` is
    // the pre-trim length. The locked 0.6.0 does not behave that way, and
    // `Cargo.toml` accepts any `0.6.x` — so pin the behaviour actually relied
    // on here. If a patch release starts honouring its own contract, this
    // fails loudly instead of every seek on a trimmed MP3 quietly landing in
    // the wrong place.
    let data = LAME_SINE_MP3.to_vec();
    let len = data.len() as u64;
    let media: Box<dyn MediaSource> = Box::new(SizedCursorSource {
        inner: Cursor::new(data),
        len,
    });
    let mss = MediaSourceStream::new(media, MediaSourceStreamOptions::default());
    let mut hint = Hint::new();
    hint.with_extension("mp3");
    let mut format = symphonia::default::get_probe()
        .probe(
            &hint,
            mss,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .expect("fixture must probe");
    let packet = format
        .next_packet()
        .expect("packet read must succeed")
        .expect("fixture must yield a first packet");
    assert!(
        packet.trim_start.get() > 0,
        "fixture's first packet must carry the encoder delay, got {}",
        packet.trim_start.get()
    );
    assert_eq!(
        packet.dur.get(),
        1152,
        "dur must still be the full MPEG-1 Layer III block, not the trimmed remainder"
    );
}

#[test]
fn seeking_a_trimmed_mp3_lands_on_the_requested_frame() {
    // The seek refinement counts frames using the packet's untrimmed length.
    // With the decoder trimming the encoder gap off the first packet, seeking
    // to the start used to skip past the buffer and drop the rest of that
    // frame (47 of 22050 frames for this fixture).
    for (ms, expected) in [
        (0u64, LAME_SINE_TRIMMED_FRAMES),
        (250, LAME_SINE_TRIMMED_FRAMES / 2),
    ] {
        let mut decoder =
            SizedDecoder::new(LAME_SINE_MP3.to_vec(), Some("mp3"), false).expect("decode");
        let channels = decoder.channels().get() as u64;
        decoder
            .try_seek(Duration::from_millis(ms))
            .expect("seek must succeed");
        let remaining = decoder.count() as u64 / channels;
        assert_eq!(
            remaining, expected,
            "seek to {ms} ms landed on the wrong frame"
        );
    }
}

#[test]
fn seeking_resets_decoder_state_and_keeps_the_waveform_aligned() {
    // A remaining-frame count cannot see either of these. Symphonia requires a
    // decoder reset after a seek because the next packet is discontinuous; for
    // MP3 the carried-over state is the bit reservoir and the synthesis overlap.
    let full: Vec<f32> = SizedDecoder::new(LAME_SINE_MP3.to_vec(), Some("mp3"), false)
        .expect("decode")
        .collect();

    let mut seeked = SizedDecoder::new(LAME_SINE_MP3.to_vec(), Some("mp3"), false).expect("decode");
    seeked
        .try_seek(Duration::from_millis(250))
        .expect("seek must succeed");
    let tail: Vec<f32> = seeked.collect();
    assert_eq!(
        tail.len() as u64,
        LAME_SINE_TRIMMED_FRAMES / 2,
        "seek should leave exactly the second half of the fixture"
    );

    // (a) MP3 rebuilds its reservoir over the first frames after a jump, so this
    // window is silent by nature. Without the reset it carries residual energy
    // from before the seek instead (measured at peak 0.093 on this fixture).
    let warmup_peak = tail[..1024].iter().fold(0f32, |m, v| m.max(v.abs()));
    assert!(
        warmup_peak < 0.01,
        "decoder state from before the seek leaked into the first frames (peak {warmup_peak})"
    );

    // (b) Once decoding is up to speed the samples must be exactly the ones a
    // full decode produces at that position — proof that the seek landed on the
    // requested frame and not merely on the right *count* of frames.
    const SKIP_WARMUP: usize = 4096;
    const WINDOW: usize = 2048;
    let offset = LAME_SINE_TRIMMED_FRAMES as usize / 2 + SKIP_WARMUP;
    let seg = &tail[SKIP_WARMUP..SKIP_WARMUP + WINDOW];
    let expected = &full[offset..offset + WINDOW];
    let mean_abs_err: f32 = seg
        .iter()
        .zip(expected)
        .map(|(a, b)| (a - b).abs())
        .sum::<f32>()
        / WINDOW as f32;
    assert!(
        mean_abs_err < 1e-6,
        "post-seek waveform does not match a full decode at the same position (mean abs error {mean_abs_err})"
    );
}
