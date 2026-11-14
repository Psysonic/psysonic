use std::path::PathBuf;

use super::{
    fallback_analysis_dispatch, is_stream_probe_failure_with_full_buffer_retry,
    FallbackAnalysisDispatch, PublishedFallbackLocation,
};

#[test]
fn published_fallback_spill_routes_analysis_from_the_file() {
    let path = PathBuf::from("fallback-spill.flac");
    match fallback_analysis_dispatch(PublishedFallbackLocation::Spill {
        path,
        analysis_file: None,
    }) {
        FallbackAnalysisDispatch::File(_) => {}
        FallbackAnalysisDispatch::Bytes => panic!("spill analysis must use the file path"),
    }
}

#[test]
fn in_memory_fallback_keeps_byte_analysis() {
    assert!(matches!(
        fallback_analysis_dispatch(PublishedFallbackLocation::Memory),
        FallbackAnalysisDispatch::Bytes
    ));
}

#[test]
fn stale_reused_spill_keeps_the_shared_cache_path() {
    let path = PathBuf::from("shared-spill.flac");
    assert!(!super::stale_fallback_spill_should_unlink(
        &path,
        Some(&path)
    ));
    assert!(super::stale_fallback_spill_should_unlink(&path, None));
}

#[test]
fn retries_ranged_probe_timeouts_from_full_buffer() {
    assert!(is_stream_probe_failure_with_full_buffer_retry(
        "ranged-stream: format probe timed out after 20s",
        Some("aiff"),
    ));
}

#[test]
fn retries_legacy_aiff_probe_failures_from_full_buffer() {
    assert!(is_stream_probe_failure_with_full_buffer_retry(
        "track-stream: format probe failed: malformed stream: aiff: missing common element",
        None,
    ));
    assert!(is_stream_probe_failure_with_full_buffer_retry(
        "track-stream: format probe timed out after 20s",
        Some("aif"),
    ));
}

#[test]
fn does_not_retry_unrelated_legacy_stream_failures() {
    assert!(!is_stream_probe_failure_with_full_buffer_retry(
        "track-stream: format probe failed: unsupported format",
        Some("mp3"),
    ));
}

/// Decodes two WAV sources with distinct sample-counter owners and verifies
/// that only the active owner counts samples across a clock handoff.
#[tokio::test]
async fn built_pcm_source_obeys_the_explicit_clock_generation() {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::Duration;
    use tauri::Manager;

    let frames: usize = 4_800;
    let data_len = (frames * 2 * 2) as u32;
    let mut wav = Vec::with_capacity(44 + data_len as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&48_000u32.to_le_bytes());
    wav.extend_from_slice(&(48_000u32 * 4).to_le_bytes());
    wav.extend_from_slice(&4u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    wav.resize(44 + data_len as usize, 0);

    let app = tauri::test::mock_app();
    app.manage(crate::stream_idle::tests::minimal_engine());
    let state = app.state::<crate::engine::AudioEngine>();
    state.current_generation.store(7, Ordering::Release);

    let shape = |clock_generation| super::PlaybackSourceShape {
        done_flag: Arc::new(AtomicBool::new(false)),
        clock_generation,
        fade_in_dur: Duration::ZERO,
        hi_res_enabled: false,
        resample_target_hz: 0,
        duration_hint: 0.1,
    };
    let outgoing_shape = shape(7);
    let incoming_shape = shape(8);
    let mut outgoing = super::build_source_from_play_input(
        super::super::play_input::PlayInput::Bytes(wav.clone()),
        &state,
        Some("wav"),
        &outgoing_shape,
    )
    .await
    .unwrap()
    .built
    .source;
    let mut incoming = super::build_source_from_play_input(
        super::super::play_input::PlayInput::Bytes(wav),
        &state,
        Some("wav"),
        &incoming_shape,
    )
    .await
    .unwrap()
    .built
    .source;

    for _ in 0..64 {
        assert!(outgoing.next().is_some());
        assert!(incoming.next().is_some());
    }
    assert_eq!(state.samples_played.load(Ordering::Relaxed), 64);

    crate::sources::activate_sample_counter_generation(
        &state.current_generation,
        &state.samples_played,
        8,
        0,
    );
    for _ in 0..64 {
        assert!(outgoing.next().is_some());
        assert!(incoming.next().is_some());
    }
    assert_eq!(
        state.samples_played.load(Ordering::Relaxed),
        64,
        "outgoing decoder must not advance the incoming generation's clock"
    );
}
