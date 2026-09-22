//! Background worker for preserve-pitch DSP (phase vocoder is too heavy for cpal callback).

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use pitch_shift::{Shifter, TOTAL_F32};
use ringbuf::traits::{Consumer, Observer, Producer, Split};
use ringbuf::{HeapCons, HeapProd, HeapRb};
use rodio::Source;

use crate::playback_rate::{
    effective_pitch, is_effect_active, preserve_out_samples, uses_preserve_dsp,
    PlaybackRateAtomics, PRESERVE_MAKEUP_GAIN,
};

const FRAME_BLOCK: usize = 128;
const PRESERVE_OUT_MAX: usize = 1023;
const PRESERVE_PARAM_EPS_PITCH: f32 = 0.05;
const PRESERVE_PARAM_EPS_SPEED: f32 = 0.001;
const RB_MIN_CAPACITY: usize = 44_100 * 2 * 2; // ~2 s stereo @ 44.1 kHz
const RB_TARGET_FILL: f32 = 0.6;
const RB_FILL_HIGH: f32 = 0.88;
const FORWARD_BATCH: usize = 4096;
const WORKER_IDLE_SLEEP: Duration = Duration::from_millis(1);
// The fresh ring prevents stale PCM from escaping after a seek. Keep the
// commit gate short; the worker continues filling the ring after handoff.
const SEEK_PREFILL_MILLIS: usize = 20;
const PREPARED_DRAIN_PER_POLL: usize = 8;

mod seek;
mod streaming;

pub(crate) use seek::StreamingSeekHandle;
use seek::{seek_channels, PreparedSeek, SeekShared};
use streaming::{prepare_permanent_seek, take_pending_seek, PreparedProducer, SeekWork};

enum WorkerCmd {
    Seek(Duration),
    Handback,
    Shutdown,
}

struct PreserveWorkerEnv {
    atomics: PlaybackRateAtomics,
    sample_rate: u32,
    channels: u16,
    capacity: usize,
    stop: Arc<AtomicBool>,
    done: Arc<AtomicBool>,
    cmd_rx: mpsc::Receiver<WorkerCmd>,
    seek_shared: Option<Arc<SeekShared>>,
    prepared_tx: Option<mpsc::Sender<PreparedSeek>>,
}

pub(crate) struct PreserveOffload {
    cons: HeapCons<f32>,
    stop: Arc<AtomicBool>,
    done: Arc<AtomicBool>,
    cmd_tx: SyncSender<WorkerCmd>,
    thread: Option<JoinHandle<()>>,
    seek_shared: Option<Arc<SeekShared>>,
    prepared_rx: Option<Receiver<PreparedSeek>>,
    prepared: VecDeque<PreparedSeek>,
    delivery_gate: Option<Arc<AtomicBool>>,
}

impl PreserveOffload {
    pub(crate) fn spawn<S: Source<Item = f32> + Send + 'static>(
        inner: S,
        atomics: PlaybackRateAtomics,
        sample_rate: u32,
        channels: u16,
        handback_tx: SyncSender<S>,
    ) -> Self {
        Self::spawn_inner(
            inner,
            atomics,
            sample_rate,
            channels,
            Some(handback_tx),
            false,
        )
        .0
    }

    pub(crate) fn spawn_permanent<S: Source<Item = f32> + Send + 'static>(
        inner: S,
        atomics: PlaybackRateAtomics,
        sample_rate: u32,
        channels: u16,
    ) -> (Self, StreamingSeekHandle, Arc<AtomicBool>) {
        let (offload, handle, delivery_gate) =
            Self::spawn_inner(inner, atomics, sample_rate, channels, None, true);
        (
            offload,
            handle.expect("permanent offload seek handle"),
            delivery_gate.expect("permanent offload delivery gate"),
        )
    }

    fn spawn_inner<S: Source<Item = f32> + Send + 'static>(
        inner: S,
        atomics: PlaybackRateAtomics,
        sample_rate: u32,
        channels: u16,
        handback_tx: Option<SyncSender<S>>,
        permanent: bool,
    ) -> (Self, Option<StreamingSeekHandle>, Option<Arc<AtomicBool>>) {
        let cap = ((sample_rate as f32 * channels as f32 * 2.5) as usize).max(RB_MIN_CAPACITY);
        let rb = HeapRb::<f32>::new(cap);
        let (prod, cons) = rb.split();
        let stop = Arc::new(AtomicBool::new(false));
        let done = Arc::new(AtomicBool::new(false));
        let (cmd_tx, cmd_rx) = mpsc::sync_channel::<WorkerCmd>(8);
        let delivery_gate = permanent.then(|| Arc::new(AtomicBool::new(false)));
        let (seek_shared, prepared_tx, prepared_rx, handle) = if permanent {
            let (shared, prepared_tx, prepared_rx, handle) = seek_channels();
            (
                Some(shared),
                Some(prepared_tx),
                Some(prepared_rx),
                Some(handle),
            )
        } else {
            (None, None, None, None)
        };
        let stop_worker = stop.clone();
        let done_worker = done.clone();
        let thread = thread::Builder::new()
            .name(if permanent {
                "psysonic-stream-decode".into()
            } else {
                "psysonic-preserve-pitch".into()
            })
            .spawn(move || {
                worker_main(
                    inner,
                    prod,
                    PreserveWorkerEnv {
                        atomics,
                        sample_rate,
                        channels,
                        capacity: cap,
                        stop: stop_worker,
                        done: done_worker,
                        cmd_rx,
                        seek_shared,
                        prepared_tx,
                    },
                    handback_tx,
                );
            })
            .expect("spawn preserve-pitch worker");

        (
            Self {
                cons,
                stop,
                done,
                cmd_tx,
                thread: Some(thread),
                seek_shared: handle.as_ref().map(|handle| handle.shared.clone()),
                prepared_rx,
                prepared: VecDeque::with_capacity(32),
                delivery_gate: delivery_gate.clone(),
            },
            handle,
            delivery_gate,
        )
    }

    pub(crate) fn pop(&mut self) -> Option<f32> {
        if self.has_pending_seek() {
            self.collect_prepared();
            if let Some(gate) = &self.delivery_gate {
                gate.store(false, Ordering::Release);
            }
            return None;
        }
        let sample = self.cons.try_pop();
        if let Some(gate) = &self.delivery_gate {
            gate.store(sample.is_some(), Ordering::Release);
        }
        sample
    }

    pub(crate) fn is_done(&self) -> bool {
        self.done.load(Ordering::Acquire)
    }

    pub(crate) fn request_seek(&self, pos: Duration) {
        let _ = self.cmd_tx.send(WorkerCmd::Seek(pos));
    }

    pub(crate) fn request_handback(&self) {
        let _ = self.cmd_tx.send(WorkerCmd::Handback);
    }

    pub(crate) fn drain(&mut self) {
        while self.cons.try_pop().is_some() {}
    }

    pub(crate) fn has_pending_seek(&self) -> bool {
        self.seek_shared.as_ref().is_some_and(|shared| {
            shared.desired_id.load(Ordering::Acquire) != shared.active_id.load(Ordering::Acquire)
        })
    }

    pub(crate) fn commit_prepared_seek(
        &mut self,
        pos: Duration,
    ) -> Result<(), rodio::source::SeekError> {
        let Some(shared) = self.seek_shared.clone() else {
            return Err(rodio::source::SeekError::NotSupported {
                underlying_source: "PreserveOffload",
            });
        };
        let desired = shared.desired_id.load(Ordering::Acquire);
        if shared.active_id.load(Ordering::Acquire) == desired
            && shared.active_pos_nanos.load(Ordering::Acquire) == duration_nanos(pos)
        {
            return Ok(());
        }
        if self.prepared_rx.is_none() {
            return Err(rodio::source::SeekError::NotSupported {
                underlying_source: "PreserveOffload",
            });
        }
        self.collect_prepared();
        let Some(index) = self
            .prepared
            .iter()
            .position(|prepared| prepared.id == desired && prepared.pos == pos)
        else {
            return Err(rodio::source::SeekError::Other(Arc::new(
                std::io::Error::new(
                    std::io::ErrorKind::WouldBlock,
                    "streaming seek was not prepared",
                ),
            )));
        };
        let prepared = self.prepared.remove(index).expect("prepared seek index");
        let old_cons = std::mem::replace(&mut self.cons, prepared.cons);
        // The worker still owns the matching producer until active_id changes,
        // so dropping this consumer cannot free the ring on the audio callback.
        drop(old_cons);
        shared
            .active_pos_nanos
            .store(duration_nanos(pos), Ordering::Release);
        shared.active_id.store(desired, Ordering::Release);
        if let Some(gate) = &self.delivery_gate {
            gate.store(true, Ordering::Release);
        }
        Ok(())
    }

    fn collect_prepared(&mut self) {
        if let Some(rx) = &self.prepared_rx {
            for _ in 0..PREPARED_DRAIN_PER_POLL {
                let Ok(prepared) = rx.try_recv() else {
                    break;
                };
                self.prepared.push_back(prepared);
            }
        }
        let Some(shared) = &self.seek_shared else {
            return;
        };
        let desired = shared.desired_id.load(Ordering::Acquire);
        let mut index = 0;
        let mut retired = 0;
        while index < self.prepared.len() && retired < PREPARED_DRAIN_PER_POLL {
            if self.prepared[index].id == desired {
                index += 1;
                continue;
            }
            let stale = self.prepared.remove(index).expect("stale seek index");
            // Drop the consumer before publishing retirement. The worker still
            // owns the producer, so ring allocation destruction stays off the
            // callback thread.
            drop(stale.cons);
            stale.retired.store(true, Ordering::Release);
            retired += 1;
        }
    }

    fn discard_all_prepared(&mut self) {
        if let Some(rx) = &self.prepared_rx {
            while let Ok(prepared) = rx.try_recv() {
                self.prepared.push_back(prepared);
            }
        }
        while let Some(stale) = self.prepared.pop_front() {
            drop(stale.cons);
            stale.retired.store(true, Ordering::Release);
        }
    }

    pub(crate) fn join(mut self) {
        self.stop.store(true, Ordering::Release);
        let _ = self.cmd_tx.send(WorkerCmd::Shutdown);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn duration_nanos(duration: Duration) -> u64 {
    duration.as_nanos().min(u64::MAX as u128) as u64
}

impl Drop for PreserveOffload {
    fn drop(&mut self) {
        self.discard_all_prepared();
        self.stop.store(true, Ordering::Release);
        let _ = self.cmd_tx.try_send(WorkerCmd::Shutdown);
        // A network read may still be in flight. Detach rather than ever joining
        // from the CPAL callback; generation cancellation or the read timeout
        // will let the worker unwind independently.
        self.thread.take();
    }
}

struct PreserveChannelState {
    shifter: Shifter<Box<[f32; TOTAL_F32]>>,
    frame: Vec<f32>,
}

impl PreserveChannelState {
    fn new() -> Self {
        Self {
            shifter: Shifter::new(Box::new([0.0; TOTAL_F32])),
            frame: Vec::with_capacity(FRAME_BLOCK),
        }
    }

    fn reset(&mut self) {
        self.shifter = Shifter::new(Box::new([0.0; TOTAL_F32]));
        self.frame.clear();
    }

    fn reset_shifter(&mut self) {
        self.shifter = Shifter::new(Box::new([0.0; TOTAL_F32]));
    }
}

struct PreserveState {
    channels: Vec<PreserveChannelState>,
    pending: VecDeque<f32>,
    channel_idx: usize,
    last_pitch: f32,
    last_speed: f32,
}

impl PreserveState {
    fn for_channels(count: u16) -> Self {
        let n = count.max(1) as usize;
        Self {
            channels: (0..n).map(|_| PreserveChannelState::new()).collect(),
            pending: VecDeque::new(),
            channel_idx: 0,
            last_pitch: f32::NAN,
            last_speed: f32::NAN,
        }
    }

    fn reset(&mut self, channels: u16) {
        let n = channels.max(1) as usize;
        if self.channels.len() != n {
            self.channels = (0..n).map(|_| PreserveChannelState::new()).collect();
        } else {
            for ch in &mut self.channels {
                ch.reset();
            }
        }
        self.pending.clear();
        self.channel_idx = 0;
        self.last_pitch = f32::NAN;
        self.last_speed = f32::NAN;
    }

    fn reset_if_params_changed(&mut self, pitch: f32, speed: f32) {
        if self.last_pitch.is_nan() {
            self.last_pitch = pitch;
            self.last_speed = speed;
            return;
        }
        if (pitch - self.last_pitch).abs() > PRESERVE_PARAM_EPS_PITCH
            || (speed - self.last_speed).abs() > PRESERVE_PARAM_EPS_SPEED
        {
            for ch in &mut self.channels {
                ch.reset_shifter();
            }
            self.pending.clear();
            self.last_pitch = pitch;
            self.last_speed = speed;
        }
    }

    fn process_block(&mut self, speed: f32, pitch: f32, sample_rate: f32) {
        self.reset_if_params_changed(pitch, speed);
        let out_n = preserve_out_samples(speed).clamp(1, PRESERVE_OUT_MAX);
        let ch_count = self.channels.len();
        let mut outs: Vec<&[f32]> = Vec::with_capacity(ch_count);
        for ch in &mut self.channels {
            if ch.frame.len() == FRAME_BLOCK {
                let out = ch.shifter.shift(&ch.frame, pitch, out_n, sample_rate);
                outs.push(out);
                ch.frame.clear();
            }
        }
        if outs.len() != ch_count {
            return;
        }
        for i in 0..out_n {
            for out_slice in &outs {
                if let Some(&sample) = out_slice.get(i) {
                    self.pending
                        .push_back((sample * PRESERVE_MAKEUP_GAIN).clamp(-1.0, 1.0));
                }
            }
        }
    }
}

fn ring_fill(prod: &HeapProd<f32>, capacity: usize) -> f32 {
    1.0 - prod.vacant_len() as f32 / capacity as f32
}

fn push_pending(prod: &mut HeapProd<f32>, pending: &mut VecDeque<f32>, stop: &AtomicBool) {
    while let Some(&s) = pending.front() {
        if stop.load(Ordering::Acquire) {
            return;
        }
        if prod.try_push(s).is_ok() {
            pending.pop_front();
        } else {
            return;
        }
    }
}

fn forward_passthrough<S: Source<Item = f32>>(
    inner: &mut S,
    prod: &mut HeapProd<f32>,
    capacity: usize,
    stop: &AtomicBool,
) -> bool {
    let target = (capacity as f32 * RB_TARGET_FILL) as usize;
    let mut pushed = 0usize;
    while prod.occupied_len() < target && pushed < FORWARD_BATCH {
        if stop.load(Ordering::Acquire) {
            return false;
        }
        let Some(s) = inner.next() else {
            return false;
        };
        if prod.try_push(s).is_err() {
            break;
        }
        pushed += 1;
    }
    true
}

fn worker_main<S: Source<Item = f32> + Send>(
    mut inner: S,
    mut prod: HeapProd<f32>,
    env: PreserveWorkerEnv,
    handback_tx: Option<SyncSender<S>>,
) {
    let ch_count = env.channels.max(1) as usize;
    let mut preserve = PreserveState::for_channels(env.channels);
    let sr = env.sample_rate as f32;
    let mut prepared_producer: Option<PreparedProducer> = None;
    let mut stale_producers: Vec<PreparedProducer> = Vec::new();

    'run: while !env.stop.load(Ordering::Acquire) {
        stale_producers.retain(|prepared| !prepared.retired.load(Ordering::Acquire));

        if let Some(prepared) = prepared_producer.take() {
            let active = env
                .seek_shared
                .as_ref()
                .map(|shared| shared.active_id.load(Ordering::Acquire))
                .unwrap_or(0);
            let desired = env
                .seek_shared
                .as_ref()
                .map(|shared| shared.desired_id.load(Ordering::Acquire))
                .unwrap_or(active);
            if active == prepared.id {
                prod = prepared.prod;
                if let Some(shared) = &env.seek_shared {
                    shared.worker_id.store(active, Ordering::Release);
                }
            } else if desired != prepared.id {
                stale_producers.push(prepared);
            } else {
                prepared_producer = Some(prepared);
            }
        }

        if let Some(request) = take_pending_seek(&env.seek_shared) {
            match prepare_permanent_seek(request, &mut inner, &mut preserve, &env) {
                SeekWork::Prepared(prepared) => prepared_producer = Some(prepared),
                SeekWork::Continue => {}
                SeekWork::Stop => break,
            }
            continue;
        }

        // The decoder now belongs to the prepared ring. Do not feed samples
        // into the old producer while the callback is still committing it.
        if prepared_producer.is_some() {
            std::thread::sleep(WORKER_IDLE_SLEEP);
            continue;
        }

        if let Ok(cmd) = env.cmd_rx.try_recv() {
            match cmd {
                WorkerCmd::Shutdown => break,
                WorkerCmd::Handback => {
                    push_pending(&mut prod, &mut preserve.pending, &env.stop);
                    if let Some(tx) = handback_tx.as_ref() {
                        let _ = tx.send(inner);
                    }
                    env.done.store(true, Ordering::Release);
                    return;
                }
                WorkerCmd::Seek(pos) => {
                    let _ = inner.try_seek(pos);
                    preserve.reset(env.channels);
                }
            }
        }

        let use_preserve = env.atomics.enabled.load(Ordering::Relaxed)
            && uses_preserve_dsp(env.atomics.load_strategy())
            && is_effect_active(&env.atomics);

        if !use_preserve {
            preserve.reset(env.channels);
            push_pending(&mut prod, &mut preserve.pending, &env.stop);
            let fill = ring_fill(&prod, env.capacity);
            if fill >= RB_FILL_HIGH {
                match env.cmd_rx.recv_timeout(WORKER_IDLE_SLEEP) {
                    Ok(WorkerCmd::Shutdown) => break 'run,
                    Ok(WorkerCmd::Handback) => {
                        push_pending(&mut prod, &mut preserve.pending, &env.stop);
                        if let Some(tx) = handback_tx.as_ref() {
                            let _ = tx.send(inner);
                        }
                        env.done.store(true, Ordering::Release);
                        return;
                    }
                    Ok(WorkerCmd::Seek(pos)) => {
                        let _ = inner.try_seek(pos);
                        preserve.reset(env.channels);
                    }
                    Err(RecvTimeoutError::Timeout) => continue,
                    Err(RecvTimeoutError::Disconnected) => break 'run,
                }
            }
            if !forward_passthrough(&mut inner, &mut prod, env.capacity, &env.stop) {
                if env.seek_shared.is_none() {
                    break;
                }
                env.done.store(true, Ordering::Release);
                std::thread::sleep(WORKER_IDLE_SLEEP);
            }
            continue;
        }

        let fill = ring_fill(&prod, env.capacity);
        if fill >= RB_FILL_HIGH {
            match env.cmd_rx.recv_timeout(WORKER_IDLE_SLEEP) {
                Ok(WorkerCmd::Shutdown) => break 'run,
                Ok(WorkerCmd::Handback) => {
                    push_pending(&mut prod, &mut preserve.pending, &env.stop);
                    if let Some(tx) = handback_tx.as_ref() {
                        let _ = tx.send(inner);
                    }
                    env.done.store(true, Ordering::Release);
                    return;
                }
                Ok(WorkerCmd::Seek(pos)) => {
                    let _ = inner.try_seek(pos);
                    preserve.reset(env.channels);
                }
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => break 'run,
            }
        }

        push_pending(&mut prod, &mut preserve.pending, &env.stop);

        if !preserve.pending.is_empty() {
            continue;
        }

        match inner.next() {
            Some(s) => {
                let ch = preserve.channel_idx;
                preserve.channels[ch].frame.push(s);
                preserve.channel_idx = (ch + 1) % ch_count;
                if preserve
                    .channels
                    .iter()
                    .all(|c| c.frame.len() >= FRAME_BLOCK)
                {
                    preserve.process_block(
                        env.atomics.load_speed(),
                        effective_pitch(&env.atomics),
                        sr,
                    );
                }
            }
            None => {
                if env.seek_shared.is_none() {
                    break;
                }
                env.done.store(true, Ordering::Release);
                std::thread::sleep(WORKER_IDLE_SLEEP);
            }
        }
    }

    push_pending(&mut prod, &mut preserve.pending, &env.stop);
    if let Some(shared) = &env.seek_shared {
        if let Some(pending) = shared.pending.lock().unwrap().take() {
            let _ = pending.ack.try_send(seek::SeekPreparation::Failed(
                "audio seek worker stopped".into(),
            ));
        }
        let active = shared.active_id.load(Ordering::Acquire);
        shared.desired_id.store(active, Ordering::Release);
        shared.worker_id.store(active, Ordering::Release);
    }
    env.done.store(true, Ordering::Release);
}

#[cfg(test)]
mod tests;
