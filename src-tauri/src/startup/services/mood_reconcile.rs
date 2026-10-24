//! Bounded online repair of ambiguous legacy mood metadata.
//!
//! Cursors advance before network work, including failures/timeouts, so one
//! unavailable record cannot starve later rows. An empty scan is cached only
//! briefly: restored/imported legacy rows must not be hidden by a permanent
//! completion marker. No cached mood is guessed or stamped authoritative here.

use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{stream, StreamExt};
use psysonic_core::server_http::ServerHttpRegistry;
use psysonic_library::mood_tags_reconcile::{
    ambiguous_mood_targets_after, apply_authoritative_native_mood_rows, AmbiguousMoodTarget,
};
use psysonic_library::repos::TrackRow;
use psysonic_library::runtime::SyncSession;
use psysonic_library::sync::bandwidth::PlaybackHint;
use psysonic_library::sync::capability::CapabilityFlags;
use psysonic_library::{LibraryRuntime, LibraryStore};
use tokio::sync::Mutex;
use tokio::time::Instant;

const TRACKS_PER_TICK: i64 = 64;
const HTTP_CONCURRENCY: usize = 4;
const FETCH_DEADLINE: Duration = Duration::from_secs(30);
const EMPTY_RETRY_DELAY: Duration = Duration::from_secs(300);

#[derive(Clone, Copy, Default)]
struct Progress {
    after_rowid: i64,
    next_probe_at: Option<Instant>,
}

#[derive(Default)]
pub(super) struct MoodReconciler {
    progress: Mutex<HashMap<String, Progress>>,
}

fn context_is_current(runtime: &LibraryRuntime, session: &SyncSession) -> bool {
    !runtime.scheduler_cancel.load(Ordering::SeqCst)
        && super::library_scheduler::scheduler_session_still_current(runtime, session)
}

fn may_fetch(runtime: &LibraryRuntime, session: &SyncSession) -> bool {
    context_is_current(runtime, session) && runtime.current_playback_hint() == PlaybackHint::Idle
}

struct FetchBatch {
    rows: Vec<TrackRow>,
    timed_out: bool,
}

async fn fetch_batch_with<F, Fut>(
    targets: Vec<AmbiguousMoodTarget>,
    deadline: Duration,
    fetch: F,
) -> FetchBatch
where
    F: FnMut(AmbiguousMoodTarget) -> Fut,
    Fut: Future<Output = Option<TrackRow>>,
{
    let pending = stream::iter(targets)
        .map(fetch)
        .buffer_unordered(HTTP_CONCURRENCY);
    futures_util::pin_mut!(pending);
    let deadline = Instant::now() + deadline;
    let mut rows = Vec::new();
    loop {
        match tokio::time::timeout_at(deadline, pending.next()).await {
            Ok(Some(Some(row))) => rows.push(row),
            Ok(Some(None)) => {}
            Ok(None) => {
                return FetchBatch {
                    rows,
                    timed_out: false,
                }
            }
            Err(_) => {
                return FetchBatch {
                    rows,
                    timed_out: true,
                }
            }
        }
    }
}

impl MoodReconciler {
    async fn next_targets(
        &self,
        store: &Arc<LibraryStore>,
        server_id: &str,
    ) -> Result<Vec<AmbiguousMoodTarget>, String> {
        let after_rowid = {
            let progress = self.progress.lock().await;
            let entry = progress.get(server_id).copied().unwrap_or_default();
            if entry.next_probe_at.is_some_and(|at| at > Instant::now()) {
                return Ok(Vec::new());
            }
            entry.after_rowid
        };
        let scan_store = Arc::clone(store);
        let scan_server = server_id.to_string();
        let targets = tokio::task::spawn_blocking(move || {
            ambiguous_mood_targets_after(&scan_store, &scan_server, after_rowid, TRACKS_PER_TICK)
        })
        .await
        .map_err(|error| error.to_string())??;

        let next = match targets.last() {
            Some(target) => Progress {
                after_rowid: target.rowid,
                next_probe_at: None,
            },
            None => Progress {
                after_rowid: 0,
                next_probe_at: Some(Instant::now() + EMPTY_RETRY_DELAY),
            },
        };
        self.progress
            .lock()
            .await
            .insert(server_id.to_string(), next);
        Ok(targets)
    }

    pub(super) async fn reconcile(
        &self,
        runtime: &LibraryRuntime,
        registry: &Arc<ServerHttpRegistry>,
        session: &SyncSession,
        flags: CapabilityFlags,
        synced_at: i64,
    ) -> Result<usize, String> {
        if !may_fetch(runtime, session) || !flags.contains(CapabilityFlags::NAVIDROME_NATIVE_BULK) {
            return Ok(0);
        }
        let Some(token) = session.navidrome_token.as_deref() else {
            return Ok(0);
        };
        let targets = self
            .next_targets(&runtime.store, &session.server_id)
            .await?;
        if targets.is_empty() {
            return Ok(0);
        }

        // Read individual current rows through the existing native endpoint.
        // No album pagination or unbounded accumulation is necessary for repair.
        let fetched = fetch_batch_with(targets, FETCH_DEADLINE, |target| async move {
            if !may_fetch(runtime, session) {
                return None;
            }
            match psysonic_integration::navidrome::queries::nd_get_song_internal(
                Some(registry.as_ref()),
                Some(&session.server_id),
                &session.base_url,
                token,
                &target.track_id,
            )
            .await
            {
                Ok(raw) => psysonic_library::sync::mapping::navidrome_song_to_track_row(
                    &session.server_id,
                    &raw,
                    synced_at,
                    None,
                ),
                Err(error) => {
                    crate::app_deprintln!(
                        "[library-sync] legacy mood track reconcile failed server_id={}: {}",
                        session.server_id,
                        error
                    );
                    None
                }
            }
        })
        .await;
        if fetched.timed_out {
            crate::app_deprintln!(
                "[library-sync] legacy mood reconcile deadline reached server_id={}",
                session.server_id
            );
        }
        if fetched.rows.is_empty() || !context_is_current(runtime, session) {
            return Ok(0);
        }
        let store = Arc::clone(&runtime.store);
        let unstable_ids = flags.contains(CapabilityFlags::UNSTABLE_TRACK_IDS);
        tokio::task::spawn_blocking(move || {
            apply_authoritative_native_mood_rows(&store, &fetched.rows, unstable_ids)
        })
        .await
        .map_err(|error| error.to_string())?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize};

    fn row(id: &str) -> TrackRow {
        psysonic_library::sync::mapping::navidrome_song_to_track_row(
            "s1",
            &serde_json::json!({"id": id, "title": id, "album": "A", "artist": "Artist"}),
            1,
            Some("lib1"),
        )
        .unwrap()
    }

    fn seed_ambiguous(store: &LibraryStore, count: usize) {
        let rows: Vec<_> = (0..count)
            .map(|index| {
                let id = format!("t{index}");
                let mut value = row(&id);
                value.raw_json = serde_json::json!({
                    "id": id, "moods": ["Dreamy"], "tags": {"genre": ["Ambient"]}
                })
                .to_string();
                value
            })
            .collect();
        psysonic_library::repos::TrackRepository::new(store)
            .upsert_batch(&rows)
            .unwrap();
    }

    fn target(index: i64) -> AmbiguousMoodTarget {
        AmbiguousMoodTarget {
            rowid: index + 1,
            track_id: format!("t{index}"),
            album_id: None,
        }
    }

    #[tokio::test]
    async fn failed_early_targets_do_not_starve_later_tracks_and_are_retried_after_wrap() {
        let store = Arc::new(LibraryStore::open_in_memory());
        seed_ambiguous(&store, TRACKS_PER_TICK as usize + 1);
        let repair = MoodReconciler::default();
        let first = repair.next_targets(&store, "s1").await.unwrap();
        assert_eq!(first.len(), TRACKS_PER_TICK as usize);
        // Failed requests leave every original row ambiguous.
        let second = repair.next_targets(&store, "s1").await.unwrap();
        assert_eq!(second.len(), 1);
        assert!(!first.iter().any(|row| row.track_id == second[0].track_id));
        assert!(repair.next_targets(&store, "s1").await.unwrap().is_empty());
        repair
            .progress
            .lock()
            .await
            .get_mut("s1")
            .unwrap()
            .next_probe_at = Some(Instant::now());
        let wrapped = repair.next_targets(&store, "s1").await.unwrap();
        assert_eq!(wrapped, first);
    }

    #[tokio::test]
    async fn empty_probe_cools_down_but_does_not_permanently_hide_imported_legacy_rows() {
        let store = Arc::new(LibraryStore::open_in_memory());
        let repair = MoodReconciler::default();
        assert!(repair.next_targets(&store, "s1").await.unwrap().is_empty());
        seed_ambiguous(&store, 1);
        assert!(repair.next_targets(&store, "s1").await.unwrap().is_empty());
        repair
            .progress
            .lock()
            .await
            .get_mut("s1")
            .unwrap()
            .next_probe_at = Some(Instant::now());
        assert_eq!(repair.next_targets(&store, "s1").await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn native_fetch_concurrency_is_bounded() {
        let live = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let batch = fetch_batch_with(
            (0..12).map(target).collect(),
            Duration::from_secs(5),
            |target| {
                let live = Arc::clone(&live);
                let peak = Arc::clone(&peak);
                async move {
                    let current = live.fetch_add(1, Ordering::SeqCst) + 1;
                    peak.fetch_max(current, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(2)).await;
                    live.fetch_sub(1, Ordering::SeqCst);
                    Some(row(&target.track_id))
                }
            },
        )
        .await;
        assert!(!batch.timed_out);
        assert_eq!(batch.rows.len(), 12);
        assert!(peak.load(Ordering::SeqCst) <= HTTP_CONCURRENCY);
        assert_eq!(live.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn deadline_keeps_completed_rows_and_cancels_a_stalled_request() {
        struct OnDrop(Arc<AtomicBool>);
        impl Drop for OnDrop {
            fn drop(&mut self) {
                self.0.store(true, Ordering::SeqCst);
            }
        }
        let dropped = Arc::new(AtomicBool::new(false));
        let batch = fetch_batch_with(
            vec![target(0), target(1)],
            Duration::from_millis(20),
            |target| {
                let dropped = Arc::clone(&dropped);
                async move {
                    if target.track_id == "t0" {
                        Some(row("t0"))
                    } else {
                        let _on_drop = OnDrop(dropped);
                        std::future::pending::<Option<TrackRow>>().await
                    }
                }
            },
        )
        .await;
        assert!(batch.timed_out);
        assert_eq!(batch.rows.len(), 1);
        assert_eq!(batch.rows[0].id, "t0");
        assert!(dropped.load(Ordering::SeqCst));
    }

    #[test]
    fn fetch_yields_to_playback_shutdown_and_stale_sessions() {
        let runtime = LibraryRuntime::new(Arc::new(LibraryStore::open_in_memory()));
        let session = SyncSession {
            server_id: "s1".into(),
            base_url: "https://test.invalid".into(),
            username: "u".into(),
            password: "p".into(),
            navidrome_token: None,
            library_scope: None,
        };
        runtime.set_session(session.clone()).unwrap();
        assert!(may_fetch(&runtime, &session));
        runtime.set_playback_hint(PlaybackHint::Playing);
        assert!(!may_fetch(&runtime, &session));
        runtime.set_playback_hint(PlaybackHint::Idle);
        runtime.scheduler_cancel.store(true, Ordering::SeqCst);
        assert!(!may_fetch(&runtime, &session));
        runtime.scheduler_cancel.store(false, Ordering::SeqCst);
        runtime.clear_session("s1");
        assert!(!context_is_current(&runtime, &session));
    }
}
