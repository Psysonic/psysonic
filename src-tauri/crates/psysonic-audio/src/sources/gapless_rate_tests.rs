use std::num::{NonZeroU16, NonZeroU32};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use rodio::{mixer, queue, ChannelCount, SampleRate, Source};

use super::{gapless_output_source, NotifyingSource};

// A streaming/offloaded source cannot report the end of its current span.
struct UnboundedSpanTrack {
    rate: SampleRate,
    channels: ChannelCount,
    remaining: usize,
    value: f32,
}

impl Iterator for UnboundedSpanTrack {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if self.remaining == 0 {
            return None;
        }
        self.remaining -= 1;
        Some(self.value)
    }
}

impl Source for UnboundedSpanTrack {
    fn current_span_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> ChannelCount {
        self.channels
    }

    fn sample_rate(&self) -> SampleRate {
        self.rate
    }

    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

fn render_gapless_tracks(first_rate: u32, second_rate: u32, channels: u16) -> (usize, usize) {
    let (input, queued) = queue::queue(true);
    let channels = NonZeroU16::new(channels).unwrap();
    for (rate, value) in [(first_rate, 1.0), (second_rate, 2.0)] {
        let source = NotifyingSource::new(
            UnboundedSpanTrack {
                rate: NonZeroU32::new(rate).unwrap(),
                channels,
                remaining: rate as usize * channels.get() as usize,
                value,
            },
            Arc::new(AtomicBool::new(false)),
        );
        input.append(gapless_output_source(
            source,
            channels,
            NonZeroU32::new(48_000).unwrap(),
        ));
    }

    let (mixer, mut output) = mixer::mixer(channels, NonZeroU32::new(48_000).unwrap());
    mixer.add(queued);
    let mut first = 0;
    let mut second = 0;
    for _ in 0..280_000 {
        let sample = output.next().unwrap();
        if sample > 1.5 {
            second += 1;
        } else if sample > 0.5 {
            first += 1;
        } else if second > 0 {
            break;
        }
    }

    (first, second)
}

#[test]
fn gapless_queue_keeps_pitch_after_unbounded_stream() {
    let (first, second) = render_gapless_tracks(44_100, 48_000, 1);
    assert!((first as i32 - 48_000).abs() <= 4, "first track: {first}");
    assert!(
        (second as i32 - 48_000).abs() <= 4,
        "second track: {second}"
    );
}

#[test]
fn gapless_queue_keeps_pitch_in_reverse_with_stereo() {
    let (first, second) = render_gapless_tracks(48_000, 44_100, 2);
    assert!((first as i32 - 96_000).abs() <= 8, "first track: {first}");
    assert!(
        (second as i32 - 96_000).abs() <= 8,
        "second track: {second}"
    );
}

// MP3/AAC end trims run through rodio's `TakeDuration`, whose span length drops
// to `Some(0)` while a sub-sample remainder of the duration is still left. The
// per-source converter must still pull the final `None` through
// `NotifyingSource`, or the engine never learns the track ended and the queue
// stalls on the next gapless switch.
fn trimmed_track_signals_done(rate: u32, channels: u16, trim: Duration) -> bool {
    let channels = NonZeroU16::new(channels).unwrap();
    let rate = NonZeroU32::new(rate).unwrap();
    let samples = vec![0.25_f32; rate.get() as usize * channels.get() as usize * 2];
    let trimmed = rodio::buffer::SamplesBuffer::new(channels, rate, samples).take_duration(trim);
    let done = Arc::new(AtomicBool::new(false));
    let mut out = gapless_output_source(
        NotifyingSource::new(trimmed, done.clone()),
        channels,
        NonZeroU32::new(48_000).unwrap(),
    );
    while out.next().is_some() {}
    done.load(std::sync::atomic::Ordering::SeqCst)
}

#[test]
fn trimmed_track_signals_done_through_gapless_converter() {
    for (rate, channels) in [(44_100, 2), (44_100, 1), (48_000, 2)] {
        for nanos in [0_u64, 5_000, 7_777, 11_000, 333_333] {
            let trim = Duration::from_secs(1) + Duration::from_nanos(nanos);
            assert!(
                trimmed_track_signals_done(rate, channels, trim),
                "done not signalled: {rate} Hz, {channels} ch, trim {trim:?}"
            );
        }
    }
}
