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
