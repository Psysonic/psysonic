use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use ringbuf::HeapCons;

pub(super) struct PendingSeek {
    pub(super) id: u64,
    pub(super) pos: Duration,
    pub(super) rollback_pos: Duration,
    pub(super) ack: SyncSender<SeekPreparation>,
}

pub(super) struct SeekShared {
    pub(super) next_id: AtomicU64,
    pub(super) desired_id: AtomicU64,
    pub(super) active_id: AtomicU64,
    pub(super) worker_id: AtomicU64,
    pub(super) active_pos_nanos: AtomicU64,
    pub(super) pending: Mutex<Option<PendingSeek>>,
}

pub(super) struct PreparedSeek {
    pub(super) id: u64,
    pub(super) pos: Duration,
    pub(super) cons: HeapCons<f32>,
    pub(super) retired: Arc<AtomicBool>,
}

pub(super) enum SeekPreparation {
    Ready {
        commit_pos: Duration,
        target_error: Option<String>,
    },
    Superseded,
    Failed(String),
}

#[derive(Clone)]
pub(crate) struct StreamingSeekHandle {
    pub(super) shared: Arc<SeekShared>,
}

pub(crate) struct StreamingSeekTicket {
    id: u64,
    commit_pos: Duration,
    target_error: Option<String>,
}

pub(super) type SeekChannels = (
    Arc<SeekShared>,
    mpsc::Sender<PreparedSeek>,
    Receiver<PreparedSeek>,
    StreamingSeekHandle,
);

pub(super) fn seek_channels() -> SeekChannels {
    let shared = Arc::new(SeekShared {
        next_id: AtomicU64::new(0),
        desired_id: AtomicU64::new(0),
        active_id: AtomicU64::new(0),
        worker_id: AtomicU64::new(0),
        active_pos_nanos: AtomicU64::new(0),
        pending: Mutex::new(None),
    });
    let (prepared_tx, prepared_rx) = mpsc::channel();
    let handle = StreamingSeekHandle {
        shared: shared.clone(),
    };
    (shared, prepared_tx, prepared_rx, handle)
}

impl StreamingSeekHandle {
    /// Prepare decoder state and a fresh PCM ring without involving the audio callback.
    /// Returns `Ok(None)` when a newer seek superseded this request.
    pub(crate) fn prepare_seek(
        &self,
        pos: Duration,
        rollback_pos: Duration,
        timeout: Duration,
    ) -> Result<Option<StreamingSeekTicket>, String> {
        let id = self.shared.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let (ack_tx, ack_rx) = mpsc::sync_channel(1);
        let replaced = {
            let mut pending = self.shared.pending.lock().unwrap();
            self.shared.desired_id.store(id, Ordering::Release);
            pending.replace(PendingSeek {
                id,
                pos,
                rollback_pos,
                ack: ack_tx,
            })
        };
        if let Some(previous) = replaced {
            let _ = previous.ack.try_send(SeekPreparation::Superseded);
        }

        match ack_rx.recv_timeout(timeout) {
            Ok(SeekPreparation::Ready {
                commit_pos,
                target_error,
            }) => Ok(Some(StreamingSeekTicket {
                id,
                commit_pos,
                target_error,
            })),
            Ok(SeekPreparation::Superseded) => Ok(None),
            Ok(SeekPreparation::Failed(error)) => Err(error),
            Err(RecvTimeoutError::Timeout) => {
                if self.cancel_if_pending(id) {
                    Err("audio seek timeout".into())
                } else {
                    match ack_rx.recv() {
                        Ok(SeekPreparation::Ready {
                            commit_pos,
                            target_error,
                        }) => Ok(Some(StreamingSeekTicket {
                            id,
                            commit_pos,
                            target_error,
                        })),
                        Ok(SeekPreparation::Superseded) => Ok(None),
                        Ok(SeekPreparation::Failed(error)) => Err(error),
                        Err(_) => Err("audio seek worker disconnected".into()),
                    }
                }
            }
            Err(RecvTimeoutError::Disconnected) => Err("audio seek worker disconnected".into()),
        }
    }

    pub(crate) fn is_current(&self, ticket: &StreamingSeekTicket) -> bool {
        self.shared.desired_id.load(Ordering::Acquire) == ticket.id
    }

    pub(crate) fn is_active(&self, ticket: &StreamingSeekTicket) -> bool {
        self.shared.active_id.load(Ordering::Acquire) == ticket.id
    }

    fn cancel_if_pending(&self, id: u64) -> bool {
        let mut pending = self.shared.pending.lock().unwrap();
        if !pending.as_ref().is_some_and(|request| request.id == id) {
            return false;
        }
        // Once another seek has moved the decoder away from the active ring,
        // cancelling only this queued request could make the worker resume into
        // that old ring from the wrong decoder position. Treat the timeout as
        // soft until the worker reaches this latest request.
        if self.shared.worker_id.load(Ordering::Acquire)
            != self.shared.active_id.load(Ordering::Acquire)
        {
            return false;
        }
        pending.take();
        let active = self.shared.active_id.load(Ordering::Acquire);
        let _ = self.shared.desired_id.compare_exchange(
            id,
            active,
            Ordering::AcqRel,
            Ordering::Acquire,
        );
        true
    }
}

impl StreamingSeekTicket {
    pub(crate) fn commit_position(&self) -> Duration {
        self.commit_pos
    }

    pub(crate) fn target_error(&self) -> Option<&str> {
        self.target_error.as_deref()
    }
}
