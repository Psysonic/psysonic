use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use ringbuf::traits::{Observer, Producer, Split};
use ringbuf::{HeapProd, HeapRb};
use rodio::Source;

use super::seek::{PendingSeek, PreparedSeek, SeekPreparation, SeekShared};
use super::{
    effective_pitch, is_effect_active, push_pending, uses_preserve_dsp, PreserveState,
    PreserveWorkerEnv, FRAME_BLOCK, SEEK_PREFILL_MILLIS,
};

pub(super) struct PreparedProducer {
    pub(super) id: u64,
    pub(super) prod: HeapProd<f32>,
    pub(super) retired: Arc<AtomicBool>,
}

pub(super) enum SeekWork {
    Prepared(PreparedProducer),
    Continue,
    Stop,
}

enum SeekPrefill {
    Ready,
    Ended,
    Superseded,
    Stopped,
}

pub(super) fn seek_prefill_samples(sample_rate: u32, channels: u16) -> usize {
    ((sample_rate as usize * channels.max(1) as usize) * SEEK_PREFILL_MILLIS / 1000)
        .max(channels.max(1) as usize)
}

fn prefill_after_seek<S: Source<Item = f32>>(
    inner: &mut S,
    prod: &mut HeapProd<f32>,
    preserve: &mut PreserveState,
    env: &PreserveWorkerEnv,
    seek_id: u64,
) -> SeekPrefill {
    let target = seek_prefill_samples(env.sample_rate, env.channels);
    let ch_count = env.channels.max(1) as usize;
    let sample_rate = env.sample_rate as f32;

    while prod.occupied_len() < target {
        if env.stop.load(Ordering::Acquire) {
            return SeekPrefill::Stopped;
        }
        if env
            .seek_shared
            .as_ref()
            .is_some_and(|shared| shared.desired_id.load(Ordering::Acquire) != seek_id)
        {
            return SeekPrefill::Superseded;
        }

        let use_preserve = env.atomics.enabled.load(Ordering::Relaxed)
            && uses_preserve_dsp(env.atomics.load_strategy())
            && is_effect_active(&env.atomics);
        if !use_preserve {
            preserve.reset(env.channels);
            match inner.next() {
                Some(sample) => {
                    let _ = prod.try_push(sample);
                }
                None => return SeekPrefill::Ended,
            }
            continue;
        }

        push_pending(prod, &mut preserve.pending, &env.stop);
        if !preserve.pending.is_empty() {
            continue;
        }
        match inner.next() {
            Some(sample) => {
                let channel = preserve.channel_idx;
                preserve.channels[channel].frame.push(sample);
                preserve.channel_idx = (channel + 1) % ch_count;
                if preserve
                    .channels
                    .iter()
                    .all(|state| state.frame.len() >= FRAME_BLOCK)
                {
                    preserve.process_block(
                        env.atomics.load_speed(),
                        effective_pitch(&env.atomics),
                        sample_rate,
                    );
                }
            }
            None => return SeekPrefill::Ended,
        }
    }
    SeekPrefill::Ready
}

pub(super) fn take_pending_seek(
    shared: &Option<std::sync::Arc<SeekShared>>,
) -> Option<PendingSeek> {
    shared
        .as_ref()
        .and_then(|shared| shared.pending.lock().unwrap().take())
}

pub(super) fn prepare_permanent_seek<S: Source<Item = f32>>(
    request: PendingSeek,
    inner: &mut S,
    preserve: &mut PreserveState,
    env: &PreserveWorkerEnv,
) -> SeekWork {
    let Some(shared) = &env.seek_shared else {
        return SeekWork::Continue;
    };
    shared.worker_id.store(request.id, Ordering::Release);
    env.done.store(false, Ordering::Release);
    let target_error = inner
        .try_seek(request.pos)
        .err()
        .map(|error| error.to_string());
    if shared.desired_id.load(Ordering::Acquire) != request.id {
        let _ = request.ack.try_send(SeekPreparation::Superseded);
        return SeekWork::Continue;
    }

    let commit_pos = if let Some(target_error) = target_error.as_ref() {
        if let Err(rollback_error) = inner.try_seek(request.rollback_pos) {
            let active = shared.active_id.load(Ordering::Acquire);
            let _ = shared.desired_id.compare_exchange(
                request.id,
                active,
                Ordering::AcqRel,
                Ordering::Acquire,
            );
            shared.worker_id.store(active, Ordering::Release);
            let _ = request.ack.try_send(SeekPreparation::Failed(format!(
                "{target_error}; rollback failed: {rollback_error}"
            )));
            return SeekWork::Stop;
        }
        request.rollback_pos
    } else {
        request.pos
    };

    preserve.reset(env.channels);
    let rb = HeapRb::<f32>::new(env.capacity);
    let (mut next_prod, next_cons) = rb.split();
    let prefill = prefill_after_seek(inner, &mut next_prod, preserve, env, request.id);
    if matches!(prefill, SeekPrefill::Superseded) {
        let _ = request.ack.try_send(SeekPreparation::Superseded);
        return SeekWork::Continue;
    }
    if matches!(prefill, SeekPrefill::Stopped) {
        let _ = request.ack.try_send(SeekPreparation::Superseded);
        return SeekWork::Stop;
    }
    if shared.desired_id.load(Ordering::Acquire) != request.id {
        let _ = request.ack.try_send(SeekPreparation::Superseded);
        return SeekWork::Continue;
    }

    if matches!(prefill, SeekPrefill::Ended) {
        env.done.store(true, Ordering::Release);
    }
    let retired = Arc::new(AtomicBool::new(false));
    if env.prepared_tx.as_ref().is_none_or(|tx| {
        tx.send(PreparedSeek {
            id: request.id,
            pos: commit_pos,
            cons: next_cons,
            retired: retired.clone(),
        })
        .is_err()
    }) {
        let _ = request.ack.try_send(SeekPreparation::Superseded);
        return SeekWork::Stop;
    }
    let _ = request.ack.try_send(SeekPreparation::Ready {
        commit_pos,
        target_error,
    });
    SeekWork::Prepared(PreparedProducer {
        id: request.id,
        prod: next_prod,
        retired,
    })
}
