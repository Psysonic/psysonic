//! Sink-lifecycle glue for `audio_play`: atomically swap a freshly built sink
//! into `state.current` (handing off the old one to a crossfade tail or a hard
//! stop), and the legacy non-seekable path that holds a sink paused until the
//! download task arms playback. Split out of `play_input.rs` so source
//! selection and source building stay focused on their own concerns.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, State};

use super::engine::{AudioCurrent, AudioEngine};
use super::playback_rate::raw_counter_samples_for_content_position;
use super::preserve_worker::StreamingSeekHandle;
use super::sources::activate_sample_counter_generation;

/// Args for [`spawn_legacy_stream_start_when_armed`].
pub(super) struct LegacyStreamStartWhenArmed {
    pub gen: u64,
    pub gen_arc: Arc<AtomicU64>,
    pub playback_armed: Arc<AtomicBool>,
    pub samples_played: Arc<AtomicU64>,
    pub current: Arc<Mutex<AudioCurrent>>,
    pub app: AppHandle,
    pub duration_secs: f64,
    pub hold_paused: bool,
}

/// Legacy `AudioStreamReader`: keep the sink paused until the download task arms
/// playback, then reset counters and emit `audio:playing` so the UI does not
/// extrapolate ahead of audible output.
pub(super) fn spawn_legacy_stream_start_when_armed(args: LegacyStreamStartWhenArmed) {
    let LegacyStreamStartWhenArmed {
        gen,
        gen_arc,
        playback_armed,
        samples_played,
        current,
        app,
        duration_secs,
        hold_paused,
    } = args;
    tokio::spawn(async move {
        loop {
            if gen_arc.load(Ordering::SeqCst) != gen {
                return;
            }
            if playback_armed.load(Ordering::Relaxed) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        if gen_arc.load(Ordering::SeqCst) != gen {
            return;
        }
        samples_played.store(0, Ordering::Relaxed);
        let sink = current.lock().unwrap().sink.clone();
        if let Some(sink) = sink {
            if hold_paused {
                sink.pause();
                let mut cur = current.lock().unwrap();
                cur.play_started = None;
                if cur.paused_at.is_none() {
                    cur.paused_at = Some(0.0);
                }
                cur.seek_offset = 0.0;
                crate::app_deprintln!(
                    "[stream] legacy track-stream: buffer ready, holding paused (silent prepare)"
                );
            } else {
                {
                    let mut cur = current.lock().unwrap();
                    cur.play_started = Some(Instant::now());
                    cur.paused_at = None;
                    cur.seek_offset = 0.0;
                }
                sink.play();
                app.emit("audio:playing", duration_secs).ok();
                crate::app_deprintln!(
                    "[stream] legacy track-stream: playback started after buffer ready"
                );
            }
        }
    });
}

/// State + decisions audio_play computed before the sink swap.
pub(crate) struct SinkSwapInputs {
    pub(crate) generation: u64,
    pub(crate) sink: Arc<rodio::Player>,
    pub(crate) duration_secs: f64,
    /// The incoming decoded source format; not the mutable engine-wide format.
    pub(crate) output_rate: u32,
    pub(crate) output_channels: u16,
    pub(crate) volume: f32,
    pub(crate) gain_linear: f32,
    pub(crate) fadeout_trigger: Arc<AtomicBool>,
    pub(crate) fadeout_samples: Arc<AtomicU64>,
    pub(crate) crossfade_enabled: bool,
    pub(crate) actual_fade_secs: f32,
    /// Track A fade-out length (decoupled from B's `actual_fade_secs` fade-in).
    /// `0` ⇒ don't fade A — it rides its own recorded fade-out (scenario A).
    pub(crate) outgoing_fade_secs: f32,
    pub(crate) start_paused: bool,
    /// Start the committed player while the current-sink mutex is held.
    pub(crate) start_playback: bool,
    /// Re-seed the clock after a successful head/resume seek, before playback.
    pub(crate) start_position_secs: Option<f64>,
    pub(crate) streaming_seek: Option<StreamingSeekHandle>,
}

/// Hand off the outgoing sink to a sample-level fade-out, then stop it after
/// `cleanup_secs`. No-op when `fade_secs <= 0` (immediate stop).
fn handoff_old_sink_fade_out(
    state: &State<'_, AudioEngine>,
    old_sink: Option<Arc<rodio::Player>>,
    old_fadeout_trigger: Option<Arc<AtomicBool>>,
    old_fadeout_samples: Option<Arc<AtomicU64>>,
    fade_secs: f32,
    cleanup_secs: f32,
) {
    let Some(old) = old_sink else {
        return;
    };
    if fade_secs <= 0.0 {
        old.stop();
        return;
    }
    let rate = state.current_sample_rate.load(Ordering::Relaxed);
    let ch = state.current_channels.load(Ordering::Relaxed);
    let fade_total = (fade_secs as f64 * rate as f64 * ch as f64) as u64;

    if let (Some(trigger), Some(samples)) = (old_fadeout_trigger, old_fadeout_samples) {
        samples.store(fade_total.max(1), Ordering::SeqCst);
        trigger.store(true, Ordering::SeqCst);
    }

    *state.fading_out_sink.lock().unwrap() = Some(old);
    let fo_arc = state.fading_out_sink.clone();
    let cleanup_dur = Duration::from_secs_f32(cleanup_secs.max(fade_secs + 0.1));
    tokio::spawn(async move {
        tokio::time::sleep(cleanup_dur).await;
        if let Some(s) = fo_arc.lock().unwrap().take() {
            s.stop();
        }
    });
}

/// Atomically swap the new sink into `state.current`, then handle the old
/// sink: trigger sample-level fade-out (crossfade enabled) or stop it
/// immediately (hard cut). The fade-out is handed off to a small spawned
/// task that drops the old sink ~`actual_fade_secs + 0.5 s` later.
pub(crate) fn swap_in_new_sink(state: &State<'_, AudioEngine>, inputs: SinkSwapInputs) {
    let SinkSwapInputs {
        generation,
        sink,
        duration_secs,
        output_rate,
        output_channels,
        volume,
        gain_linear,
        fadeout_trigger: new_fadeout_trigger,
        fadeout_samples: new_fadeout_samples,
        crossfade_enabled,
        actual_fade_secs,
        outgoing_fade_secs,
        start_paused,
        start_playback,
        start_position_secs,
        streaming_seek,
    } = inputs;

    let (old_sink, old_fadeout_trigger, old_fadeout_samples) = {
        let mut cur = state.current.lock().unwrap();
        let old = cur.sink.take();
        let old_fo_trigger = cur.fadeout_trigger.take();
        let old_fo_samples = cur.fadeout_samples.take();
        cur.sink = Some(sink.clone());
        cur.duration_secs = duration_secs;
        cur.seek_offset = start_position_secs.unwrap_or(0.0);
        if start_paused {
            sink.pause();
            cur.play_started = None;
            cur.paused_at = Some(cur.seek_offset);
        } else {
            cur.play_started = Some(Instant::now());
            cur.paused_at = None;
        }
        cur.replay_gain_linear = gain_linear;
        cur.base_volume = volume.clamp(0.0, 1.0);
        cur.fadeout_trigger = Some(new_fadeout_trigger);
        cur.fadeout_samples = Some(new_fadeout_samples);
        cur.streaming_seek = streaming_seek;
        let initial_samples = start_position_secs
            .map(|secs| {
                raw_counter_samples_for_content_position(
                    secs,
                    output_rate,
                    output_channels as u32,
                    &state.playback_rate,
                )
            })
            .unwrap_or(0);
        activate_sample_counter_generation(
            &state.current_generation,
            &state.samples_played,
            generation,
            initial_samples,
        );
        // Keep the first play() under `current`: a pause issued after
        // this handoff cannot be overtaken by a delayed initial start.
        if start_playback {
            sink.play();
        }
        (old, old_fo_trigger, old_fo_samples)
    };

    if crossfade_enabled {
        if outgoing_fade_secs > 0.0 {
            // Scenario A (`outgoing_fade_secs == 0`): A keeps full engine gain;
            // still keep the old sink alive until B's fade-in window elapses.
            handoff_old_sink_fade_out(
                state,
                old_sink,
                old_fadeout_trigger,
                old_fadeout_samples,
                outgoing_fade_secs,
                actual_fade_secs.max(outgoing_fade_secs) + 0.5,
            );
        } else if let Some(old) = old_sink {
            // Prep already volume-ducked A; scenario-A keeps sample gain at 1.0
            // so clamp the handoff sink or A blasts over B's fade-in.
            if state.interrupt_outgoing_duck_active.load(Ordering::Relaxed) {
                old.set_volume(0.0);
            }
            *state.fading_out_sink.lock().unwrap() = Some(old);
            let fo_arc = state.fading_out_sink.clone();
            let cleanup_dur = Duration::from_secs_f32(actual_fade_secs + 0.5);
            tokio::spawn(async move {
                tokio::time::sleep(cleanup_dur).await;
                if let Some(s) = fo_arc.lock().unwrap().take() {
                    s.stop();
                }
            });
        }
    } else if let Some(old) = old_sink {
        old.stop();
    }
    state
        .interrupt_outgoing_duck_active
        .store(false, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::num::{NonZeroU16, NonZeroU32};

    /// Infinite stereo PCM with a separate counter for *actual* samples mixed.
    /// It distinguishes the outgoing tail from the incoming track's samples.
    struct ObservedPcm {
        consumed: Arc<AtomicU64>,
    }

    impl Iterator for ObservedPcm {
        type Item = f32;

        fn next(&mut self) -> Option<f32> {
            self.consumed.fetch_add(1, Ordering::Relaxed);
            Some(0.01)
        }
    }

    impl rodio::Source for ObservedPcm {
        fn current_span_len(&self) -> Option<usize> {
            None
        }

        fn channels(&self) -> rodio::ChannelCount {
            NonZeroU16::new(2).unwrap()
        }

        fn sample_rate(&self) -> rodio::SampleRate {
            NonZeroU32::new(48_000).unwrap()
        }

        fn total_duration(&self) -> Option<Duration> {
            None
        }
    }

    fn observed_player(
        mixer: &rodio::mixer::Mixer,
        engine: &AudioEngine,
        generation: u64,
    ) -> (Arc<rodio::Player>, Arc<AtomicU64>) {
        let consumed = Arc::new(AtomicU64::new(0));
        let mut counted = crate::sources::CountingSource::new(
            ObservedPcm {
                consumed: Arc::clone(&consumed),
            },
            engine.samples_played.clone(),
        );
        counted.track_generation(engine.current_generation.clone(), generation);
        let sink = Arc::new(rodio::Player::connect_new(mixer));
        sink.pause();
        sink.append(counted);
        (sink, consumed)
    }

    fn swap_args(
        generation: u64,
        sink: Arc<rodio::Player>,
        crossfade: bool,
        start_position_secs: Option<f64>,
    ) -> SinkSwapInputs {
        SinkSwapInputs {
            generation,
            sink,
            duration_secs: 30.0,
            output_rate: 48_000,
            output_channels: 2,
            volume: 1.0,
            gain_linear: 1.0,
            fadeout_trigger: Arc::new(AtomicBool::new(false)),
            fadeout_samples: Arc::new(AtomicU64::new(0)),
            crossfade_enabled: crossfade,
            actual_fade_secs: 1.0,
            outgoing_fade_secs: if crossfade { 1.0 } else { 0.0 },
            start_paused: false,
            start_playback: true,
            start_position_secs,
            streaming_seek: None,
        }
    }

    #[tokio::test]
    async fn deferred_and_start_paused_swaps_leave_real_sinks_paused() {
        use tauri::Manager;

        let app = tauri::test::mock_app();
        app.manage(crate::stream_idle::tests::minimal_engine());
        let state = app.state::<AudioEngine>();
        let (mixer, _output) = rodio::mixer::mixer(
            NonZeroU16::new(2).unwrap(),
            NonZeroU32::new(48_000).unwrap(),
        );

        for (generation, start_paused) in [(1, false), (2, true)] {
            let (sink, _) = observed_player(&mixer, &state, generation);
            let mut inputs = swap_args(generation, sink.clone(), false, None);
            inputs.start_playback = false;
            inputs.start_paused = start_paused;
            swap_in_new_sink(&state, inputs);
            assert!(sink.is_paused());
            assert_eq!(state.current_generation.load(Ordering::Acquire), generation);
        }
    }

    #[tokio::test]
    async fn start_offset_uses_immutable_source_format_not_engine_atomics() {
        use tauri::Manager;

        let app = tauri::test::mock_app();
        app.manage(crate::stream_idle::tests::minimal_engine());
        let state = app.state::<AudioEngine>();
        // Simulate a late concurrent format update: it must not alter the
        // offset seeded for the incoming 48 kHz stereo decoded source.
        state.current_sample_rate.store(44_100, Ordering::Relaxed);
        state.current_channels.store(1, Ordering::Relaxed);
        let (mixer, _output) = rodio::mixer::mixer(
            NonZeroU16::new(2).unwrap(),
            NonZeroU32::new(48_000).unwrap(),
        );
        let (sink, _) = observed_player(&mixer, &state, 7);
        swap_in_new_sink(&state, swap_args(7, sink, false, Some(2.0)));

        assert_eq!(state.current_generation.load(Ordering::Acquire), 7);
        assert_eq!(state.samples_played.load(Ordering::Relaxed), 2 * 48_000 * 2);
    }

    #[tokio::test]
    async fn real_sink_crossfade_counts_only_incoming_mixed_samples() {
        use tauri::Manager;

        let app = tauri::test::mock_app();
        app.manage(crate::stream_idle::tests::minimal_engine());
        let state = app.state::<AudioEngine>();
        state.current_sample_rate.store(48_000, Ordering::Relaxed);
        state.current_channels.store(2, Ordering::Relaxed);
        let (mixer, mut output) = rodio::mixer::mixer(
            NonZeroU16::new(2).unwrap(),
            NonZeroU32::new(48_000).unwrap(),
        );

        let (sink_a, observed_a) = observed_player(&mixer, &state, 1);
        swap_in_new_sink(&state, swap_args(1, sink_a, false, None));
        for _ in 0..512 {
            assert!(output.next().is_some());
        }
        assert!(observed_a.load(Ordering::Relaxed) > 0);
        assert_eq!(
            state.samples_played.load(Ordering::Relaxed),
            observed_a.load(Ordering::Relaxed)
        );

        let (sink_b, observed_b) = observed_player(&mixer, &state, 2);
        swap_in_new_sink(&state, swap_args(2, sink_b.clone(), true, None));
        assert_eq!(state.current_generation.load(Ordering::Acquire), 2);
        assert_eq!(state.samples_played.load(Ordering::Relaxed), 0);
        assert!(!sink_b.is_paused());

        let old_before = observed_a.load(Ordering::Relaxed);
        for _ in 0..512 {
            assert!(output.next().is_some());
        }
        assert!(
            observed_a.load(Ordering::Relaxed) > old_before,
            "outgoing source did not contribute overlapping audio"
        );
        assert!(observed_b.load(Ordering::Relaxed) > 0);
        assert_eq!(
            state.samples_played.load(Ordering::Relaxed),
            observed_b.load(Ordering::Relaxed),
            "outgoing audio must not advance the incoming playback clock"
        );
    }

    #[tokio::test]
    async fn real_swap_head_offset_and_immediate_pause_remain_committed() {
        use tauri::Manager;

        let app = tauri::test::mock_app();
        app.manage(crate::stream_idle::tests::minimal_engine());
        let state = app.state::<AudioEngine>();
        state.current_sample_rate.store(48_000, Ordering::Relaxed);
        state.current_channels.store(2, Ordering::Relaxed);
        let (mixer, mut output) = rodio::mixer::mixer(
            NonZeroU16::new(2).unwrap(),
            NonZeroU32::new(48_000).unwrap(),
        );

        let (sink_a, _) = observed_player(&mixer, &state, 1);
        swap_in_new_sink(&state, swap_args(1, sink_a, false, None));
        for _ in 0..128 {
            assert!(output.next().is_some());
        }

        let (sink_b, observed_b) = observed_player(&mixer, &state, 2);
        swap_in_new_sink(&state, swap_args(2, sink_b.clone(), true, Some(3.0)));
        let seeded_samples = 3 * 48_000 * 2;
        assert_eq!(state.samples_played.load(Ordering::Relaxed), seeded_samples);
        assert!(!sink_b.is_paused());

        // Exercise the real transport command immediately after publication.
        crate::transport_commands::audio_pause(None, app.state::<AudioEngine>());
        assert!(sink_b.is_paused());
        assert_eq!(state.current.lock().unwrap().paused_at, Some(3.0));
        for _ in 0..512 {
            assert!(output.next().is_some());
        }
        assert_eq!(observed_b.load(Ordering::Relaxed), 0);
        assert_eq!(
            state.samples_played.load(Ordering::Relaxed),
            seeded_samples,
            "delayed playback or outgoing audio must not undo the paused clock"
        );
    }
}
