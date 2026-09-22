//! Transport-control Tauri commands: pause / resume / stop / seek.
//! These don't drive playback startup — they mutate state on an already-running
//! sink (or coordinate radio reconnect for cold-resume).

use std::sync::atomic::Ordering;
use std::sync::{Arc, TryLockError};
use std::time::{Duration, Instant};

use ringbuf::traits::Split;
use ringbuf::HeapRb;
use tauri::{AppHandle, State};

use super::engine::{audio_http_client, AudioEngine};
use super::helpers::{
    cancel_sink_volume_ramp, cancel_transport_sink_volume_ramp,
    ramp_sink_volume_smooth_over_secs_then, sink_volume_now, MASTER_HEADROOM,
};
use super::playback_rate::{
    content_position_from_samples, raw_counter_samples_for_content_position,
};
use super::preview::preview_clear_for_new_main_playback;
use super::stream::{radio_download_task, RADIO_BUF_CAPACITY};

pub(crate) async fn seek_player_with_timeout(
    sink: Arc<rodio::Player>,
    position: Duration,
    timeout: Duration,
) -> Result<(), String> {
    let seek_task = tokio::task::spawn_blocking(move || {
        sink.try_seek(position).map_err(|error| error.to_string())
    });
    match tokio::time::timeout(timeout, seek_task).await {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => Err(format!("audio seek worker join failed: {error}")),
        Err(_) => Err("audio seek timeout".to_string()),
    }
}

fn finish_failed_seek(
    state: &AudioEngine,
    sink: &Arc<rodio::Player>,
    request_id: u64,
    generation: u64,
    error: String,
) -> Result<(), String> {
    let _commit_guard = state.playback_commit_lock.lock().unwrap();
    let mut pending_seek = state.pending_seek.lock().unwrap();
    if !pending_seek.is_current(request_id, generation) {
        return Ok(());
    }

    if error.contains("audio seek timeout")
        && state.generation.load(Ordering::SeqCst) == generation
        && state.current_generation.load(Ordering::Acquire) == generation
    {
        let mut current = state.current.lock().unwrap();
        if current
            .sink
            .as_ref()
            .is_some_and(|current_sink| Arc::ptr_eq(current_sink, sink))
        {
            // A timed-out blocking task cannot be cancelled. Remove and stop
            // the exact player before returning so fallback cannot seek a
            // silent, stopped sink that is still published as current.
            current.sink = None;
            current.streaming_seek = None;
            current.play_started = None;
            current.paused_at = None;
            state.current_generation.store(0, Ordering::Release);
            sink.stop();
            let _ = state.generation.compare_exchange(
                generation,
                generation + 1,
                Ordering::SeqCst,
                Ordering::SeqCst,
            );
        }
    }

    pending_seek.finish(request_id, generation);
    Err(error)
}

#[tauri::command]
#[specta::specta]
pub fn audio_pause(fade_secs: Option<f32>, state: State<'_, AudioEngine>) {
    cancel_sink_volume_ramp();
    cancel_transport_sink_volume_ramp();
    let fade_secs = sanitize_pause_resume_fade_secs(fade_secs);
    if let Some(fade_secs) = fade_secs {
        let sink = {
            let cur = state.current.lock().unwrap();
            cur.sink.as_ref().filter(|sink| !sink.is_paused()).cloned()
        };
        if let Some(sink) = sink {
            let current = Arc::clone(&state.current);
            let samples_played = Arc::clone(&state.samples_played);
            let sample_rate = Arc::clone(&state.current_sample_rate);
            let channels = Arc::clone(&state.current_channels);
            let playback_rate = state.playback_rate.clone();
            let completion_sink = Arc::clone(&sink);
            let from = sink_volume_now(&sink);
            ramp_sink_volume_smooth_over_secs_then(sink, from, 0.0, fade_secs, move || {
                let mut cur = current.lock().unwrap();
                let Some(active_sink) = cur.sink.as_ref() else {
                    return;
                };
                if !Arc::ptr_eq(active_sink, &completion_sink) || active_sink.is_paused() {
                    return;
                }
                let pos = content_position_from_samples(
                    samples_played.load(Ordering::Relaxed),
                    sample_rate.load(Ordering::Relaxed),
                    channels.load(Ordering::Relaxed),
                    &playback_rate,
                )
                .min(cur.duration_secs.max(0.001));
                active_sink.pause();
                cur.paused_at = Some(pos);
                cur.play_started = None;
            });
        }
    } else {
        pause_current_sink(&state);
    }
    // Notify the download task so it can start measuring the hard-pause stall timer.
    if let Some(rs) = state.radio_state.lock().unwrap().as_ref() {
        rs.flags.is_paused.store(true, Ordering::Release);
    }
}

/// Resume playback.
///
/// **Warm resume** (`is_hard_paused = false`): download task is still running,
/// buffer has buffered audio.  `sink.play()` suffices.
///
/// **Cold resume** (`is_hard_paused = true`): TCP was dropped.  A fresh 4 MB
/// ring buffer is created, its consumer is sent to `AudioStreamReader` (which
/// swaps it in on the next `read()`), and a new download task is spawned.
#[tauri::command]
#[specta::specta]
pub async fn audio_resume(
    fade_secs: Option<f32>,
    state: State<'_, AudioEngine>,
    app: AppHandle,
) -> Result<(), String> {
    cancel_sink_volume_ramp();
    cancel_transport_sink_volume_ramp();
    let fade_secs = sanitize_pause_resume_fade_secs(fade_secs);
    // If a preview is running, cancel it first — otherwise sink.play() on the
    // main sink would mix on top of the preview sink.
    preview_clear_for_new_main_playback(&state, &app);

    // Detect radio hard-disconnect.
    let reconnect_info = {
        let guard = state.radio_state.lock().unwrap();
        guard
            .as_ref()
            .filter(|rs| rs.flags.is_hard_paused.load(Ordering::Acquire))
            .map(|rs| (rs.url.clone(), rs.gen, rs.flags.clone()))
    };

    if let Some((url, gen, flags)) = reconnect_info {
        let rb = HeapRb::<u8>::new(RADIO_BUF_CAPACITY);
        let (new_prod, new_cons) = rb.split();

        // Send new consumer to AudioStreamReader (non-blocking; unbounded channel).
        let ok = flags.new_cons_tx.lock().unwrap().send(new_cons).is_ok();

        if ok {
            let new_task = tokio::spawn(radio_download_task(
                gen,
                state.generation.clone(),
                None, // task performs its own fresh GET
                audio_http_client(&state),
                url,
                new_prod,
                flags.clone(),
                app,
            ));
            if let Some(rs) = state.radio_state.lock().unwrap().as_mut() {
                let old = std::mem::replace(&mut rs.task, new_task);
                old.abort(); // ensure any lingering old task is gone
                rs.flags.is_hard_paused.store(false, Ordering::Release);
                rs.flags.is_paused.store(false, Ordering::Release);
            }
        } else {
            crate::app_eprintln!("[radio] resume: AudioStreamReader gone — skipping reconnect");
        }
    }

    // Resume the rodio Sink (works for both warm and cold resume).
    let resume_ramp = {
        let mut cur = state.current.lock().unwrap();
        if let Some(sink) = cur.sink.clone() {
            let target =
                (cur.base_volume * cur.replay_gain_linear * MASTER_HEADROOM).clamp(0.0, 1.0);
            if sink.is_paused() {
                let pos = cur.paused_at.unwrap_or(cur.seek_offset);
                if fade_secs.is_some() {
                    sink.set_volume(0.0);
                } else {
                    sink.set_volume(target);
                }
                sink.play();
                cur.seek_offset = pos;
                cur.play_started = Some(Instant::now());
                cur.paused_at = None;
            } else if fade_secs.is_none() {
                sink.set_volume(target);
            }
            fade_secs.map(|secs| (Arc::clone(&sink), sink_volume_now(&sink), target, secs))
        } else {
            None
        }
    };
    if let Some((sink, from, target, secs)) = resume_ramp {
        let current = Arc::clone(&state.current);
        let completion_sink = Arc::clone(&sink);
        ramp_sink_volume_smooth_over_secs_then(sink, from, target, secs, move || {
            let cur = current.lock().unwrap();
            if cur
                .sink
                .as_ref()
                .is_some_and(|active_sink| Arc::ptr_eq(active_sink, &completion_sink))
            {
                completion_sink.set_volume(
                    (cur.base_volume * cur.replay_gain_linear * MASTER_HEADROOM).clamp(0.0, 1.0),
                );
            }
        });
    }
    if let Some(rs) = state.radio_state.lock().unwrap().as_ref() {
        rs.flags.is_paused.store(false, Ordering::Release);
    }
    Ok(())
}

fn sanitize_pause_resume_fade_secs(fade_secs: Option<f32>) -> Option<f32> {
    fade_secs
        .filter(|secs| secs.is_finite() && *secs > 0.0)
        .map(|secs| secs.clamp(0.1, 2.0))
}

fn pause_current_sink(state: &AudioEngine) {
    let mut cur = state.current.lock().unwrap();
    if let Some(sink) = &cur.sink {
        if !sink.is_paused() {
            let pos = content_position_from_samples(
                state.samples_played.load(Ordering::Relaxed),
                state.current_sample_rate.load(Ordering::Relaxed),
                state.current_channels.load(Ordering::Relaxed),
                &state.playback_rate,
            )
            .min(cur.duration_secs.max(0.001));
            sink.pause();
            cur.paused_at = Some(pos);
            cur.play_started = None;
        }
    }
}

#[cfg(test)]
mod pause_resume_fade_tests {
    use super::sanitize_pause_resume_fade_secs;

    #[test]
    fn disabled_or_invalid_fade_stays_immediate() {
        assert_eq!(sanitize_pause_resume_fade_secs(None), None);
        assert_eq!(sanitize_pause_resume_fade_secs(Some(0.0)), None);
        assert_eq!(sanitize_pause_resume_fade_secs(Some(f32::NAN)), None);
    }

    #[test]
    fn fade_duration_is_clamped_to_the_settings_range() {
        assert_eq!(sanitize_pause_resume_fade_secs(Some(0.01)), Some(0.1));
        assert_eq!(sanitize_pause_resume_fade_secs(Some(0.3)), Some(0.3));
        assert_eq!(sanitize_pause_resume_fade_secs(Some(9.0)), Some(2.0));
    }
}

#[tauri::command]
#[specta::specta]
pub fn audio_stop(state: State<'_, AudioEngine>, app: AppHandle) {
    cancel_sink_volume_ramp();
    cancel_transport_sink_volume_ramp();
    preview_clear_for_new_main_playback(&state, &app);
    let stop_generation = {
        let _commit_guard = state.playback_commit_lock.lock().unwrap();
        let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
        state.invalidate_pending_seek();
        *state.current_playback_url.lock().unwrap() = None;
        *state.current_analysis_track_id.lock().unwrap() = None;
        *state.current_playback_server_id.lock().unwrap() = None;
        *state.chained_info.lock().unwrap() = None;
        *state.current_source_done.lock().unwrap() = None;
        // Keep `stream_completed_cache`: natural track end often calls `audio_stop` when the
        // queue is exhausted; clearing here dropped the full ranged buffer and forced a
        // re-download on replay. The slot is only consumed on `take`/overwrite for another URL.
        // Drop RadioLiveState → triggers Drop → task.abort() → TCP released.
        drop(state.radio_state.lock().unwrap().take());
        let mut cur = state.current.lock().unwrap();
        if let Some(sink) = cur.sink.take() {
            sink.stop();
        }
        cur.duration_secs = 0.0;
        cur.seek_offset = 0.0;
        cur.play_started = None;
        cur.paused_at = None;
        cur.streaming_seek = None;
        generation
    };
    let _ = super::stream_idle::release_output_stream_on_stop(state.inner(), &app, stop_generation);
}

#[tauri::command]
#[specta::specta]
pub async fn audio_seek(seconds: f64, state: State<'_, AudioEngine>) -> Result<(), String> {
    let state = state.inner();
    const AUDIO_SEEK_TIMEOUT_MS: u64 = 700;
    const AUDIO_SEEK_LOCK_TIMEOUT_MS: u64 = 40;
    // Multiple user seeks may overlap so Rodio's latest-wins control slot can
    // supersede stale requests. Same-generation source replacement must wait
    // before the ghost/source checks and through final commit.
    let _source_transition = state.source_transition_lock.read().await;

    // Ghost-command guard: reject seeks within 500 ms of a gapless auto-advance.
    {
        let switch_ms = state.gapless_switch_at.load(Ordering::SeqCst);
        if switch_ms > 0 {
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            if now_ms.saturating_sub(switch_ms) < 500 {
                return Ok(());
            }
        }
    }

    crate::app_deprintln!("[seek] target={:.2}s", seconds);

    let lock_current_with_timeout = |timeout_ms: u64| {
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);
        loop {
            match state.current.try_lock() {
                Ok(guard) => break Ok(guard),
                Err(TryLockError::WouldBlock) => {
                    if Instant::now() >= deadline {
                        break Err("audio seek busy".to_string());
                    }
                    std::thread::sleep(Duration::from_millis(2));
                }
                Err(TryLockError::Poisoned(_)) => {
                    break Err("audio state lock poisoned".to_string());
                }
            }
        }
    };

    // Seeking back invalidates any pending gapless chain.
    let cur_pos = content_position_from_samples(
        state.samples_played.load(Ordering::Relaxed),
        state.current_sample_rate.load(Ordering::Relaxed),
        state.current_channels.load(Ordering::Relaxed),
        &state.playback_rate,
    );
    if seconds < cur_pos - 1.0 {
        *state.chained_info.lock().unwrap() = None;
    }

    let seek_seconds = seconds.max(0.0);
    let seek_duration = Duration::from_secs_f64(seek_seconds);
    let rollback_duration = Duration::from_secs_f64(cur_pos.max(0.0));
    let seek_generation = state.generation.load(Ordering::SeqCst);
    let (sink, streaming_seek) = {
        let cur = lock_current_with_timeout(AUDIO_SEEK_LOCK_TIMEOUT_MS)?;
        if state.current_generation.load(Ordering::Acquire) != seek_generation {
            return Err("audio sink not ready".to_string());
        }
        match cur.sink.as_ref() {
            Some(sink) => (Arc::clone(sink), cur.streaming_seek.clone()),
            None => return Err("audio sink not ready".to_string()),
        }
    };
    // Only consult seekability after proving the sink belongs to this playback
    // generation. During async startup the flag may still describe the outgoing
    // source; that case must retry as "sink not ready", not restart playback.
    if !state.current_is_seekable.load(Ordering::SeqCst) {
        crate::app_deprintln!("[seek] rejected → not-seekable source (legacy stream)");
        return Err("source is not seekable".into());
    }
    let sample_rate = state.current_sample_rate.load(Ordering::Relaxed);
    let channels = state.current_channels.load(Ordering::Relaxed);
    let target_samples = raw_counter_samples_for_content_position(
        seek_seconds,
        sample_rate,
        channels,
        &state.playback_rate,
    );
    let seek_request_id = state.begin_pending_seek(seek_generation, target_samples, seek_seconds);
    let finish_progress = || state.finish_pending_seek(seek_request_id, seek_generation);
    if state.generation.load(Ordering::SeqCst) != seek_generation {
        finish_progress();
        return Ok(());
    }

    let seek_ticket = if let Some(handle) = streaming_seek.as_ref() {
        let prepare_handle = handle.clone();
        let prepared = match tokio::task::spawn_blocking(move || {
            prepare_handle.prepare_seek(
                seek_duration,
                rollback_duration,
                Duration::from_millis(AUDIO_SEEK_TIMEOUT_MS),
            )
        })
        .await
        {
            Ok(Ok(prepared)) => prepared,
            Ok(Err(error)) => {
                finish_progress();
                return Err(error);
            }
            Err(error) => {
                finish_progress();
                return Err(format!("audio seek worker join failed: {error}"));
            }
        };
        match prepared {
            Some(ticket) => Some(ticket),
            None => {
                finish_progress();
                return Ok(());
            }
        }
    } else {
        None
    };
    let commit_duration = seek_ticket
        .as_ref()
        .map_or(seek_duration, |ticket| ticket.commit_position());
    if !state.pending_seek_is_current(seek_request_id, seek_generation)
        || state.generation.load(Ordering::SeqCst) != seek_generation
        || state.current_generation.load(Ordering::Acquire) != seek_generation
    {
        finish_progress();
        return Ok(());
    }
    let sink_is_current = {
        let cur = lock_current_with_timeout(AUDIO_SEEK_LOCK_TIMEOUT_MS)?;
        cur.sink
            .as_ref()
            .is_some_and(|current_sink| Arc::ptr_eq(current_sink, &sink))
    };
    if !sink_is_current {
        finish_progress();
        return Ok(());
    }
    if let Some((handle, ticket)) = streaming_seek.as_ref().zip(seek_ticket.as_ref()) {
        loop {
            if !state.pending_seek_is_current(seek_request_id, seek_generation)
                || state.generation.load(Ordering::SeqCst) != seek_generation
                || !handle.is_current(ticket)
            {
                finish_progress();
                return Ok(());
            }
            let seek_result = seek_player_with_timeout(
                Arc::clone(&sink),
                commit_duration,
                Duration::from_millis(AUDIO_SEEK_TIMEOUT_MS),
            )
            .await;
            if let Err(error) = seek_result {
                if !handle.is_current(ticket) {
                    finish_progress();
                    return Ok(());
                }
                return finish_failed_seek(state, &sink, seek_request_id, seek_generation, error);
            }
            if !handle.is_current(ticket) {
                finish_progress();
                return Ok(());
            }
            if handle.is_active(ticket) {
                break;
            }
            if state.generation.load(Ordering::SeqCst) != seek_generation {
                finish_progress();
                return Ok(());
            }
            // Rodio replaces an unprocessed seek order when another command
            // wins the controls slot. Retry while this ticket is still latest.
        }
    } else {
        if !state.pending_seek_is_current(seek_request_id, seek_generation)
            || state.generation.load(Ordering::SeqCst) != seek_generation
        {
            finish_progress();
            return Ok(());
        }
        let seek_result = seek_player_with_timeout(
            Arc::clone(&sink),
            commit_duration,
            Duration::from_millis(AUDIO_SEEK_TIMEOUT_MS),
        )
        .await;
        if let Err(error) = seek_result {
            return finish_failed_seek(state, &sink, seek_request_id, seek_generation, error);
        }
    }
    if let Some(error) = seek_ticket
        .as_ref()
        .and_then(|ticket| ticket.target_error())
    {
        finish_progress();
        return Err(error.to_string());
    }

    // Commit progress and timestamps under the same lifecycle lock used by
    // play/stop generation changes. Holding pending_seek through the writes
    // prevents a newer request from publishing between validation and commit.
    let _commit_guard = state.playback_commit_lock.lock().unwrap();
    let mut pending_seek = state.pending_seek.lock().unwrap();
    if state.generation.load(Ordering::SeqCst) != seek_generation
        || !pending_seek.is_current(seek_request_id, seek_generation)
    {
        pending_seek.finish(seek_request_id, seek_generation);
        return Ok(());
    }
    let mut cur = match lock_current_with_timeout(AUDIO_SEEK_LOCK_TIMEOUT_MS) {
        Ok(cur) => cur,
        Err(error) => {
            pending_seek.finish(seek_request_id, seek_generation);
            return Err(error);
        }
    };
    if !cur
        .sink
        .as_ref()
        .is_some_and(|current_sink| Arc::ptr_eq(current_sink, &sink))
        || state.current_generation.load(Ordering::Acquire) != seek_generation
    {
        pending_seek.finish(seek_request_id, seek_generation);
        return Ok(());
    }

    if cur.paused_at.is_some() {
        cur.paused_at = Some(seek_seconds);
    } else {
        cur.seek_offset = seek_seconds;
        cur.play_started = Some(Instant::now());
    }
    state
        .samples_played
        .store(target_samples, Ordering::Relaxed);
    pending_seek.finish(seek_request_id, seek_generation);
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::engine::PendingSeekState;

    #[test]
    fn latest_seek_can_finish_its_pending_state() {
        let mut pending = PendingSeekState::default();
        let request_id = pending.begin(7, 900, 9.0);

        assert!(pending.finish(request_id, 7));
        assert_eq!(pending.target_samples(), None);
    }

    #[test]
    fn superseded_seek_cannot_finish_newer_pending_state() {
        let mut pending = PendingSeekState::default();
        let old_request_id = pending.begin(7, 300, 3.0);
        let new_request_id = pending.begin(7, 1_200, 12.0);

        assert!(!pending.finish(old_request_id, 7));
        assert!(pending.is_current(new_request_id, 7));
        assert_eq!(pending.target_samples(), Some(1_200));
        assert_eq!(pending.take_target_secs(7), Some(12.0));
        assert!(!pending.is_current(new_request_id, 7));
    }

    #[test]
    fn recovery_discards_a_pending_seek_from_an_old_generation() {
        let mut pending = PendingSeekState::default();
        let request_id = pending.begin(6, 900, 9.0);

        assert_eq!(pending.take_target_secs(7), None);
        assert!(!pending.is_current(request_id, 6));
    }
}
