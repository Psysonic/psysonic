//! Small shared structs for preload / gapless chain metadata.
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// Completion signal for the source currently owned by a playback generation.
/// Hi-Res realignment may replace the source without incrementing generation,
/// so the progress task must resolve this slot dynamically instead of retaining
/// the flag created by the original `audio_play` call.
pub(crate) type CurrentSourceDone = Arc<Mutex<Option<(u64, Arc<AtomicBool>)>>>;

/// Publish a source completion flag only while its playback generation remains
/// current. Holding the slot lock across the generation check prevents a late
/// resume/rebuild from overwriting a newer play's flag.
pub(crate) fn install_current_source_done(
    slot: &CurrentSourceDone,
    generation: &AtomicU64,
    expected_generation: u64,
    done: Arc<AtomicBool>,
) -> bool {
    let mut current = slot.lock().unwrap();
    if generation.load(Ordering::SeqCst) != expected_generation {
        return false;
    }
    *current = Some((expected_generation, done));
    true
}

/// Sample counter of the gapless successor that is currently audible. A chained
/// source counts into its own `Arc` because its predecessor is still counting
/// into `samples_played` while the successor waits in the sink.
pub(crate) type ChainedSampleCounter = Arc<Mutex<Option<(u64, Arc<AtomicU64>)>>>;

/// The counter the audible source writes to. Falls back to `base` unless a
/// gapless transition of the current generation published a successor's counter,
/// so a new play invalidates the slot just by bumping the generation.
pub(crate) fn active_sample_counter(
    slot: &ChainedSampleCounter,
    generation: &AtomicU64,
    base: &Arc<AtomicU64>,
) -> Arc<AtomicU64> {
    slot.lock()
        .unwrap()
        .as_ref()
        .filter(|(counter_generation, _)| *counter_generation == generation.load(Ordering::SeqCst))
        .map_or_else(|| base.clone(), |(_, counter)| counter.clone())
}

pub(crate) struct PreloadedTrack {
    pub(crate) url: String,
    pub(crate) data: Vec<u8>,
    /// Provenance captured with retained local bytes. Remote buffers leave this
    /// unset because their analysis eligibility does not depend on local cache metadata.
    pub(crate) local_original_verified: Option<bool>,
}

/// Completed ranged stream too large for `stream_completed_cache`; bytes live on disk.
pub(crate) struct StreamCompletedSpill {
    pub(crate) url: String,
    pub(crate) path: std::path::PathBuf,
}

/// Info about the track that has been appended (chained) to the current Sink
/// but whose source has not yet started playing (gapless mode only).
pub(crate) struct ChainedInfo {
    /// The URL that was chained — used by audio_play to detect a pre-chain hit.
    pub(crate) url: String,
    /// Subsonic track id for analysis dispatch (from `audio_chain_preload`).
    pub(crate) analysis_track_id: Option<String>,
    /// Playback server scope for analysis writes.
    pub(crate) server_id: Option<String>,
    /// Positive provenance for local cached bytes. Carried across the automatic
    /// gapless boundary because no new frontend command runs at that point.
    pub(crate) local_original_verified: Option<bool>,
    /// Main playback generation shared with the predecessor. Gapless advances
    /// do not bump it, so provenance events can remain identity-qualified.
    pub(crate) generation: u64,
    /// Raw file bytes (shared with the chained decoder). Lets manual skip reuse
    /// them instead of re-downloading after dropping the Sink queue.
    pub(crate) raw_bytes: Arc<Vec<u8>>,
    /// Real decoded format of the chained successor, for the `audio:format`
    /// event emitted at the gapless transition.
    pub(crate) resolved_format: Option<crate::decode::ResolvedCodecInfo>,
    /// Actual source shape after any blend-rate resampling.
    pub(crate) output_rate: u32,
    pub(crate) output_channels: u16,
    pub(crate) duration_secs: f64,
    pub(crate) replay_gain_linear: f32,
    pub(crate) base_volume: f32,
    /// Set by NotifyingSource when this chained track's source is exhausted.
    pub(crate) source_done: Arc<AtomicBool>,
    /// Stops this queued source when preload configuration is invalidated,
    /// without touching the source that is currently audible.
    pub(crate) cancel: Arc<AtomicBool>,
    /// Atomic sample counter for this chained source (swapped into
    /// samples_played on transition).
    pub(crate) sample_counter: Arc<AtomicU64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_generation_cannot_replace_current_source_completion() {
        let generation = AtomicU64::new(2);
        let current_done = Arc::new(AtomicBool::new(false));
        let slot = Arc::new(Mutex::new(Some((2, current_done.clone()))));

        assert!(!install_current_source_done(
            &slot,
            &generation,
            1,
            Arc::new(AtomicBool::new(false)),
        ));

        let guard = slot.lock().unwrap();
        let (slot_generation, slot_done) = guard.as_ref().unwrap();
        assert_eq!(*slot_generation, 2);
        assert!(Arc::ptr_eq(slot_done, &current_done));
    }

    #[test]
    fn active_counter_is_the_successor_of_the_current_generation() {
        let generation = AtomicU64::new(3);
        let base = Arc::new(AtomicU64::new(0));
        let successor = Arc::new(AtomicU64::new(0));
        let slot = Arc::new(Mutex::new(Some((3, successor.clone()))));

        let active = active_sample_counter(&slot, &generation, &base);

        assert!(Arc::ptr_eq(&active, &successor));
    }

    #[test]
    fn active_counter_ignores_a_successor_of_an_older_generation() {
        let generation = AtomicU64::new(4);
        let base = Arc::new(AtomicU64::new(0));
        let slot = Arc::new(Mutex::new(Some((3, Arc::new(AtomicU64::new(0))))));

        let active = active_sample_counter(&slot, &generation, &base);

        assert!(Arc::ptr_eq(&active, &base));
    }

    #[test]
    fn active_counter_is_the_base_without_a_successor() {
        let generation = AtomicU64::new(1);
        let base = Arc::new(AtomicU64::new(0));
        let slot: ChainedSampleCounter = Arc::new(Mutex::new(None));

        let active = active_sample_counter(&slot, &generation, &base);

        assert!(Arc::ptr_eq(&active, &base));
    }
}
