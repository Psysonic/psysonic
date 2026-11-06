use super::*;
use rodio::Source;
use std::time::Duration;

struct TwoSamples(u8);
impl Iterator for TwoSamples {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        match self.0 {
            0 => {
                self.0 = 1;
                Some(0.1)
            }
            1 => {
                self.0 = 2;
                Some(0.2)
            }
            _ => None,
        }
    }
}
impl Source for TwoSamples {
    fn current_span_len(&self) -> Option<usize> {
        Some(1)
    }
    fn channels(&self) -> rodio::ChannelCount {
        std::num::NonZero::new(1).unwrap()
    }
    fn sample_rate(&self) -> rodio::SampleRate {
        std::num::NonZero::new(44_100).unwrap()
    }
    fn total_duration(&self) -> Option<Duration> {
        Some(Duration::from_secs_f32(2.0 / 44_100.0))
    }
}

#[test]
fn gated_counter_skips_samples_until_gate_is_set() {
    let counter = Arc::new(AtomicU64::new(0));
    let gate = Arc::new(AtomicBool::new(false));
    let mut src = CountingSource::new_gated(TwoSamples(0), counter.clone(), gate.clone());
    assert_eq!(src.next(), Some(0.1));
    assert_eq!(src.next(), Some(0.2));
    assert_eq!(counter.load(Ordering::Relaxed), 0);
    gate.store(true, Ordering::SeqCst);
    let mut src2 = CountingSource::new_gated(TwoSamples(0), counter.clone(), gate);
    assert_eq!(src2.next(), Some(0.1));
    assert_eq!(counter.load(Ordering::Relaxed), 1);
}

#[test]
fn cancelled_source_exhausts_without_reading_more_successor_samples() {
    let cancel = Arc::new(AtomicBool::new(false));
    let mut src = CancellableSource::new(TwoSamples(0), cancel.clone());
    assert_eq!(src.next(), Some(0.1));
    cancel.store(true, Ordering::Release);
    assert_eq!(src.next(), None);
    assert_eq!(src.current_span_len(), Some(0));
}

/// Tiny seekable stream at 10 samples/s so a 12 s blend needs only 120 samples.
struct TimedSamples {
    remaining: usize,
}

impl Iterator for TimedSamples {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if self.remaining == 0 {
            return None;
        }
        self.remaining -= 1;
        Some(0.1)
    }
}

impl Source for TimedSamples {
    fn current_span_len(&self) -> Option<usize> {
        Some(self.remaining)
    }

    fn channels(&self) -> rodio::ChannelCount {
        std::num::NonZero::new(1).unwrap()
    }

    fn sample_rate(&self) -> rodio::SampleRate {
        std::num::NonZero::new(10).unwrap()
    }

    fn total_duration(&self) -> Option<Duration> {
        Some(Duration::from_secs_f64(self.remaining as f64 / 10.0))
    }

    fn try_seek(&mut self, _pos: Duration) -> Result<(), rodio::source::SeekError> {
        // Test position accounting only; no decoder or PCM seeking is required.
        Ok(())
    }
}

#[test]
fn crossfade_tail_cannot_double_count_incoming_progress() {
    let current_generation = Arc::new(AtomicU64::new(1));
    let counter = Arc::new(AtomicU64::new(0));
    let mut outgoing = CountingSource::new(TimedSamples { remaining: 300 }, counter.clone());
    outgoing.track_generation(current_generation.clone(), 1);
    let mut incoming = CountingSource::new(TimedSamples { remaining: 300 }, counter.clone());
    incoming.track_generation(current_generation.clone(), 2);

    for _ in 0..40 {
        assert!(outgoing.next().is_some());
    }
    assert_eq!(counter.load(Ordering::Relaxed), 40);
    // The incoming source is still private while the outgoing track plays.
    assert!(incoming.next().is_some());
    assert_eq!(counter.load(Ordering::Relaxed), 40);

    activate_sample_counter_generation(&current_generation, &counter, 2, 0);
    for _ in 0..120 {
        assert!(outgoing.next().is_some());
        assert!(incoming.next().is_some());
    }
    // 12 s of simultaneous audio must advance the incoming clock by 12 s,
    // not 24 s. Otherwise lyrics, seeking and the following AutoDJ trigger drift.
    assert_eq!(counter.load(Ordering::Relaxed), 120);
}

#[test]
fn inactive_source_seek_does_not_reanchor_active_progress() {
    let current_generation = Arc::new(AtomicU64::new(1));
    let counter = Arc::new(AtomicU64::new(20));
    let mut outgoing = CountingSource::new(TimedSamples { remaining: 300 }, counter.clone());
    outgoing.track_generation(current_generation.clone(), 1);
    let mut incoming = CountingSource::new(TimedSamples { remaining: 300 }, counter.clone());
    incoming.track_generation(current_generation.clone(), 2);

    // B-head silence trimming happens before the new sink takes ownership.
    assert!(incoming.try_seek(Duration::from_secs(4)).is_ok());
    assert_eq!(counter.load(Ordering::Relaxed), 20);
    // The committed swap seeds the successful B-head seek before new audio.
    activate_sample_counter_generation(&current_generation, &counter, 2, 40);
    assert_eq!(counter.load(Ordering::Relaxed), 40);
    // A late seek/decoder action on the outgoing tail must never overwrite B.
    assert!(outgoing.try_seek(Duration::from_secs(9)).is_ok());
    assert_eq!(counter.load(Ordering::Relaxed), 40);
    for _ in 0..30 {
        assert!(incoming.next().is_some());
        assert!(outgoing.next().is_some());
    }
    assert_eq!(counter.load(Ordering::Relaxed), 70);
}

#[test]
fn repeated_handoffs_cannot_accumulate_earlier_track_samples() {
    let current_generation = Arc::new(AtomicU64::new(1));
    let counter = Arc::new(AtomicU64::new(0));
    let mut a = CountingSource::new(TimedSamples { remaining: 10 }, counter.clone());
    let mut b = CountingSource::new(TimedSamples { remaining: 10 }, counter.clone());
    let mut c = CountingSource::new(TimedSamples { remaining: 10 }, counter.clone());
    a.track_generation(current_generation.clone(), 1);
    b.track_generation(current_generation.clone(), 2);
    c.track_generation(current_generation.clone(), 3);

    a.next();
    activate_sample_counter_generation(&current_generation, &counter, 2, 0);
    a.next();
    b.next();
    assert_eq!(counter.load(Ordering::Relaxed), 1);

    activate_sample_counter_generation(&current_generation, &counter, 3, 0);
    b.next();
    c.next();
    assert_eq!(counter.load(Ordering::Relaxed), 1);
}

#[test]
fn stream_readiness_gate_and_playback_ownership_both_apply() {
    let current_generation = Arc::new(AtomicU64::new(4));
    let counter = Arc::new(AtomicU64::new(0));
    let ready = Arc::new(AtomicBool::new(false));
    let mut source = CountingSource::new_gated(
        TimedSamples { remaining: 10 },
        counter.clone(),
        ready.clone(),
    );
    source.track_generation(current_generation.clone(), 4);

    source.next();
    assert_eq!(counter.load(Ordering::Relaxed), 0);
    ready.store(true, Ordering::SeqCst);
    source.next();
    assert_eq!(counter.load(Ordering::Relaxed), 1);
    current_generation.store(5, Ordering::SeqCst);
    source.next();
    assert_eq!(counter.load(Ordering::Relaxed), 1);
}

#[test]
fn rebuilt_hi_res_outgoing_source_keeps_old_clock_owner() {
    let current_generation = Arc::new(AtomicU64::new(8));
    let counter = Arc::new(AtomicU64::new(80));
    let mut rebuilt_outgoing =
        CountingSource::new(TimedSamples { remaining: 200 }, counter.clone());
    // The resampled outgoing source belongs to the snapshot (A: 8), not
    // the new play request (B: 9).
    rebuilt_outgoing.track_generation(current_generation.clone(), 8);
    rebuilt_outgoing.next();
    assert_eq!(counter.load(Ordering::Relaxed), 81);
    activate_sample_counter_generation(&current_generation, &counter, 9, 0);
    for _ in 0..100 {
        rebuilt_outgoing.next();
    }
    assert_eq!(counter.load(Ordering::Relaxed), 0);
}

#[test]
fn device_recovery_source_cannot_count_after_next_crossfade() {
    let current_generation = Arc::new(AtomicU64::new(12));
    let counter = Arc::new(AtomicU64::new(0));
    let mut recovered = CountingSource::new(TimedSamples { remaining: 200 }, counter.clone());
    recovered.track_generation(current_generation.clone(), 12);
    for _ in 0..20 {
        recovered.next();
    }
    assert_eq!(counter.load(Ordering::Relaxed), 20);
    activate_sample_counter_generation(&current_generation, &counter, 13, 0);
    for _ in 0..40 {
        recovered.next();
    }
    assert_eq!(counter.load(Ordering::Relaxed), 0);
}

#[test]
fn gapless_hi_res_rebuilt_source_cannot_pollute_next_track() {
    let current_generation = Arc::new(AtomicU64::new(22));
    let counter = Arc::new(AtomicU64::new(30));
    let mut realigned = CountingSource::new(TimedSamples { remaining: 200 }, counter.clone());
    realigned.track_generation(current_generation.clone(), 22);
    assert!(realigned.try_seek(Duration::from_secs(4)).is_ok());
    assert_eq!(counter.load(Ordering::Relaxed), 40);
    activate_sample_counter_generation(&current_generation, &counter, 23, 0);
    for _ in 0..40 {
        realigned.next();
    }
    assert_eq!(counter.load(Ordering::Relaxed), 0);
}

#[test]
fn committed_head_seek_seeds_new_generation_before_first_sample() {
    let current_generation = Arc::new(AtomicU64::new(3));
    let counter = Arc::new(AtomicU64::new(100));
    let mut incoming = CountingSource::new(TimedSamples { remaining: 100 }, counter.clone());
    incoming.track_generation(current_generation.clone(), 4);
    activate_sample_counter_generation(&current_generation, &counter, 4, 50);
    assert_eq!(counter.load(Ordering::Relaxed), 50);
    assert!(incoming.next().is_some());
    assert_eq!(counter.load(Ordering::Relaxed), 51);
}
