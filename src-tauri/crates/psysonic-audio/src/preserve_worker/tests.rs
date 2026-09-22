use super::*;
use crate::playback_rate::STRATEGY_PRESERVE_PITCH;
use rodio::{ChannelCount, SampleRate};
use std::sync::{Condvar, Mutex};
use std::time::Duration as StdDuration;
use std::time::Instant;

struct SineSource {
    remaining: usize,
    rate: u32,
}

impl Iterator for SineSource {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if self.remaining == 0 {
            return None;
        }
        self.remaining -= 1;
        Some(0.25)
    }
}

impl Source for SineSource {
    fn current_span_len(&self) -> Option<usize> {
        Some(self.remaining)
    }

    fn channels(&self) -> ChannelCount {
        std::num::NonZero::new(2).unwrap()
    }

    fn sample_rate(&self) -> SampleRate {
        SampleRate::new(self.rate).unwrap()
    }

    fn total_duration(&self) -> Option<StdDuration> {
        Some(StdDuration::from_secs(1))
    }
}

#[test]
fn worker_prefills_ring_before_done() {
    let atomics = PlaybackRateAtomics::new();
    atomics.enabled.store(true, Ordering::Relaxed);
    atomics
        .strategy
        .store(STRATEGY_PRESERVE_PITCH, Ordering::Relaxed);
    atomics.speed.store(1.25f32.to_bits(), Ordering::Relaxed);

    let source = SineSource {
        remaining: 44_100 * 2,
        rate: 44_100,
    };
    let (tx, _rx) = mpsc::sync_channel(1);
    let mut offload = PreserveOffload::spawn(source, atomics, 44_100, 2, tx);
    std::thread::sleep(Duration::from_millis(150));
    let mut received = 0usize;
    for _ in 0..10_000 {
        if offload.pop().is_some() {
            received += 1;
            if received > 500 {
                break;
            }
        } else if offload.is_done() {
            break;
        } else {
            std::thread::sleep(Duration::from_millis(1));
        }
    }
    assert!(
        received > 500,
        "expected prefetched samples, got {received}"
    );
}

#[derive(Default)]
struct ControlledState {
    block_read: bool,
    read_entered: bool,
    release_read: bool,
    block_first_seek: bool,
    block_second_seek: bool,
    seek_entered: bool,
    release_seek: bool,
    seek_failures_remaining: usize,
    seeks: Vec<Duration>,
}

struct ControlledSource {
    control: Arc<(Mutex<ControlledState>, Condvar)>,
    marker: f32,
}

impl Iterator for ControlledSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let (lock, wake) = &*self.control;
        let mut state = lock.lock().unwrap();
        if state.block_read && !state.release_read {
            state.read_entered = true;
            wake.notify_all();
            state = wake.wait_while(state, |state| !state.release_read).unwrap();
        }
        drop(state);
        Some(self.marker)
    }
}

impl Source for ControlledSource {
    fn current_span_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> ChannelCount {
        ChannelCount::new(1).unwrap()
    }

    fn sample_rate(&self) -> SampleRate {
        SampleRate::new(1_000).unwrap()
    }

    fn total_duration(&self) -> Option<Duration> {
        None
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        let (lock, wake) = &*self.control;
        let mut state = lock.lock().unwrap();
        state.seeks.push(pos);
        let should_block = (state.block_first_seek && state.seeks.len() == 1)
            || (state.block_second_seek && state.seeks.len() == 2);
        if should_block && !state.release_seek {
            state.seek_entered = true;
            wake.notify_all();
            state = wake.wait_while(state, |state| !state.release_seek).unwrap();
        }
        if state.seek_failures_remaining > 0 {
            state.seek_failures_remaining -= 1;
            return Err(rodio::source::SeekError::Other(Arc::new(
                std::io::Error::other("scripted seek failure"),
            )));
        }
        drop(state);
        self.marker = if pos >= Duration::from_secs(2) {
            0.75
        } else {
            0.25
        };
        Ok(())
    }
}

fn wait_for_control(
    control: &Arc<(Mutex<ControlledState>, Condvar)>,
    ready: impl Fn(&ControlledState) -> bool,
) {
    let (lock, wake) = &**control;
    let state = lock.lock().unwrap();
    let (state, timeout) = wake
        .wait_timeout_while(state, Duration::from_secs(1), |state| !ready(state))
        .unwrap();
    assert!(!timeout.timed_out() && ready(&state));
}

#[test]
fn permanent_offload_keeps_blocking_reads_off_the_callback() {
    let control = Arc::new((
        Mutex::new(ControlledState {
            block_read: true,
            ..ControlledState::default()
        }),
        Condvar::new(),
    ));
    let source = ControlledSource {
        control: control.clone(),
        marker: -0.75,
    };
    let (mut offload, _handle, _gate) =
        PreserveOffload::spawn_permanent(source, PlaybackRateAtomics::new(), 1_000, 1);
    wait_for_control(&control, |state| state.read_entered);

    let started = Instant::now();
    assert_eq!(offload.pop(), None);
    assert!(started.elapsed() < Duration::from_millis(20));

    let (lock, wake) = &*control;
    lock.lock().unwrap().release_read = true;
    wake.notify_all();
}

#[test]
fn pending_seek_mutes_old_pcm_and_commits_a_fresh_ring() {
    let control = Arc::new((
        Mutex::new(ControlledState {
            block_first_seek: true,
            ..ControlledState::default()
        }),
        Condvar::new(),
    ));
    let source = ControlledSource {
        control: control.clone(),
        marker: -0.75,
    };
    let (mut offload, handle, delivery_gate) =
        PreserveOffload::spawn_permanent(source, PlaybackRateAtomics::new(), 1_000, 1);
    let target = Duration::from_secs(2);
    let prepare = std::thread::spawn(move || {
        handle.prepare_seek(target, Duration::ZERO, Duration::from_secs(1))
    });
    wait_for_control(&control, |state| state.seek_entered);

    assert_eq!(offload.pop(), None, "old PCM must be gated during seek");
    assert!(!delivery_gate.load(Ordering::Acquire));
    let (lock, wake) = &*control;
    lock.lock().unwrap().release_seek = true;
    wake.notify_all();

    assert!(prepare.join().unwrap().unwrap().is_some());
    offload.commit_prepared_seek(target).unwrap();
    assert_eq!(offload.pop(), Some(0.75));
    assert!(delivery_gate.load(Ordering::Acquire));
}

#[test]
fn timeout_cancels_only_a_seek_the_worker_has_not_started() {
    let control = Arc::new((
        Mutex::new(ControlledState {
            block_read: true,
            ..ControlledState::default()
        }),
        Condvar::new(),
    ));
    let source = ControlledSource {
        control: control.clone(),
        marker: -0.75,
    };
    let (offload, handle, _gate) =
        PreserveOffload::spawn_permanent(source, PlaybackRateAtomics::new(), 1_000, 1);
    wait_for_control(&control, |state| state.read_entered);

    assert!(handle
        .prepare_seek(
            Duration::from_secs(2),
            Duration::ZERO,
            Duration::from_millis(20),
        )
        .is_err());
    assert!(!offload.has_pending_seek());

    let (lock, wake) = &*control;
    lock.lock().unwrap().release_read = true;
    wake.notify_all();
}

#[test]
fn an_in_flight_seek_finishes_after_the_soft_timeout() {
    let control = Arc::new((
        Mutex::new(ControlledState {
            block_first_seek: true,
            ..ControlledState::default()
        }),
        Condvar::new(),
    ));
    let source = ControlledSource {
        control: control.clone(),
        marker: -0.75,
    };
    let (_offload, handle, _gate) =
        PreserveOffload::spawn_permanent(source, PlaybackRateAtomics::new(), 1_000, 1);
    let prepare = std::thread::spawn(move || {
        handle.prepare_seek(
            Duration::from_secs(2),
            Duration::ZERO,
            Duration::from_millis(20),
        )
    });
    wait_for_control(&control, |state| state.seek_entered);
    std::thread::sleep(Duration::from_millis(40));
    assert!(!prepare.is_finished());

    let (lock, wake) = &*control;
    lock.lock().unwrap().release_seek = true;
    wake.notify_all();
    assert!(prepare.join().unwrap().unwrap().is_some());
}

#[test]
fn permanent_seek_prefills_through_preserve_pitch_dsp() {
    let atomics = PlaybackRateAtomics::new();
    atomics.enabled.store(true, Ordering::Relaxed);
    atomics
        .strategy
        .store(STRATEGY_PRESERVE_PITCH, Ordering::Relaxed);
    atomics.speed.store(1.25f32.to_bits(), Ordering::Relaxed);
    let source = ControlledSource {
        control: Arc::new((Mutex::new(ControlledState::default()), Condvar::new())),
        marker: 0.25,
    };
    let (mut offload, handle, _gate) = PreserveOffload::spawn_permanent(source, atomics, 1_000, 1);
    let target = Duration::from_secs(2);

    assert!(handle
        .prepare_seek(target, Duration::ZERO, Duration::from_secs(1))
        .unwrap()
        .is_some());
    offload.commit_prepared_seek(target).unwrap();
    assert!(offload.pop().is_some());
}

#[test]
fn permanent_seek_prefill_stays_bounded_at_high_sample_rates() {
    assert_eq!(streaming::seek_prefill_samples(96_000, 2), 3_840);
    assert_eq!(streaming::seek_prefill_samples(44_100, 2), 1_764);
}

#[test]
fn permanent_offload_keeps_only_the_latest_seek() {
    let control = Arc::new((
        Mutex::new(ControlledState {
            block_first_seek: true,
            ..ControlledState::default()
        }),
        Condvar::new(),
    ));
    let source = ControlledSource {
        control: control.clone(),
        marker: -0.75,
    };
    let (mut offload, handle, _gate) =
        PreserveOffload::spawn_permanent(source, PlaybackRateAtomics::new(), 1_000, 1);

    let first_handle = handle.clone();
    let first = std::thread::spawn(move || {
        first_handle.prepare_seek(
            Duration::from_secs(1),
            Duration::ZERO,
            Duration::from_secs(1),
        )
    });
    wait_for_control(&control, |state| state.seek_entered);

    let middle_handle = handle.clone();
    let middle = std::thread::spawn(move || {
        middle_handle.prepare_seek(
            Duration::from_millis(1500),
            Duration::ZERO,
            Duration::from_secs(1),
        )
    });
    let deadline = Instant::now() + Duration::from_secs(1);
    while handle.shared.desired_id.load(Ordering::Acquire) < 2 {
        assert!(Instant::now() < deadline, "middle seek was not published");
        std::thread::yield_now();
    }
    let latest_handle = handle.clone();
    let latest = std::thread::spawn(move || {
        latest_handle.prepare_seek(
            Duration::from_secs(2),
            Duration::ZERO,
            Duration::from_secs(1),
        )
    });
    let deadline = Instant::now() + Duration::from_secs(1);
    while handle.shared.desired_id.load(Ordering::Acquire) < 3 {
        assert!(Instant::now() < deadline, "latest seek was not published");
        std::thread::yield_now();
    }

    let (lock, wake) = &*control;
    lock.lock().unwrap().release_seek = true;
    wake.notify_all();

    assert!(first.join().unwrap().unwrap().is_none());
    assert!(middle.join().unwrap().unwrap().is_none());
    assert!(latest.join().unwrap().unwrap().is_some());
    offload
        .commit_prepared_seek(Duration::from_secs(2))
        .unwrap();
    assert_eq!(offload.pop(), Some(0.75));
    assert_eq!(
        control.0.lock().unwrap().seeks,
        vec![Duration::from_secs(1), Duration::from_secs(2)]
    );
}

#[test]
fn stale_commit_does_not_discard_the_latest_prepared_ring() {
    let source = ControlledSource {
        control: Arc::new((Mutex::new(ControlledState::default()), Condvar::new())),
        marker: -0.75,
    };
    let (mut offload, handle, _gate) =
        PreserveOffload::spawn_permanent(source, PlaybackRateAtomics::new(), 1_000, 1);

    let first_target = Duration::from_secs(1);
    let first = handle
        .prepare_seek(first_target, Duration::ZERO, Duration::from_secs(1))
        .unwrap()
        .expect("first prepared seek");
    let latest_target = Duration::from_secs(2);
    let latest = handle
        .prepare_seek(latest_target, first_target, Duration::from_secs(1))
        .unwrap()
        .expect("latest prepared seek");

    assert!(offload
        .commit_prepared_seek(first.commit_position())
        .is_err());
    offload
        .commit_prepared_seek(latest.commit_position())
        .expect("latest prepared ring must remain available");
    assert_eq!(offload.pop(), Some(0.75));
}

#[test]
fn dropping_a_blocked_permanent_offload_never_joins_the_worker() {
    let control = Arc::new((
        Mutex::new(ControlledState {
            block_read: true,
            ..ControlledState::default()
        }),
        Condvar::new(),
    ));
    let source = ControlledSource {
        control: control.clone(),
        marker: -0.75,
    };
    let (offload, _handle, _gate) =
        PreserveOffload::spawn_permanent(source, PlaybackRateAtomics::new(), 1_000, 1);
    wait_for_control(&control, |state| state.read_entered);

    let started = Instant::now();
    drop(offload);
    assert!(started.elapsed() < Duration::from_millis(20));

    let (lock, wake) = &*control;
    lock.lock().unwrap().release_read = true;
    wake.notify_all();
}

#[test]
fn failed_seek_commits_a_fresh_rollback_ring() {
    let control = Arc::new((
        Mutex::new(ControlledState {
            seek_failures_remaining: 1,
            ..ControlledState::default()
        }),
        Condvar::new(),
    ));
    let source = ControlledSource {
        control: control.clone(),
        marker: -0.75,
    };
    let (mut offload, handle, _gate) =
        PreserveOffload::spawn_permanent(source, PlaybackRateAtomics::new(), 1_000, 1);

    let deadline = Instant::now() + Duration::from_secs(1);
    while offload.pop().is_none() {
        assert!(Instant::now() < deadline, "initial PCM was not prefetched");
        std::thread::sleep(Duration::from_millis(1));
    }

    let rollback = Duration::from_millis(500);
    let ticket = handle
        .prepare_seek(Duration::from_secs(2), rollback, Duration::from_secs(1))
        .unwrap()
        .expect("rollback preparation");
    assert!(ticket.target_error().is_some());
    assert_eq!(ticket.commit_position(), rollback);
    offload.commit_prepared_seek(rollback).unwrap();
    assert_eq!(offload.pop(), Some(0.25));
    assert_eq!(
        control.0.lock().unwrap().seeks,
        vec![Duration::from_secs(2), rollback]
    );
}

#[test]
fn worker_failure_releases_a_newer_soft_timed_out_seek() {
    let control = Arc::new((
        Mutex::new(ControlledState {
            block_second_seek: true,
            seek_failures_remaining: 2,
            ..ControlledState::default()
        }),
        Condvar::new(),
    ));
    let source = ControlledSource {
        control: control.clone(),
        marker: -0.75,
    };
    let (_offload, handle, _gate) =
        PreserveOffload::spawn_permanent(source, PlaybackRateAtomics::new(), 1_000, 1);

    let first_handle = handle.clone();
    let first = std::thread::spawn(move || {
        first_handle.prepare_seek(
            Duration::from_secs(1),
            Duration::ZERO,
            Duration::from_millis(20),
        )
    });
    wait_for_control(&control, |state| state.seek_entered);

    let latest = std::thread::spawn(move || {
        handle.prepare_seek(
            Duration::from_secs(2),
            Duration::ZERO,
            Duration::from_millis(20),
        )
    });
    std::thread::sleep(Duration::from_millis(40));
    assert!(!latest.is_finished());

    let (lock, wake) = &*control;
    lock.lock().unwrap().release_seek = true;
    wake.notify_all();

    assert!(first.join().unwrap().is_err());
    assert!(latest.join().unwrap().is_err());
}
