//! Observe initialization's existing reads; never probe, seek, or read for layout.
use std::io::{self, Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use symphonia::core::io::MediaSource;

use super::channel_layout::{verify_channel_layout, MAX_CAPTURE_BYTES};
use super::format::ResolvedCodecInfo;

struct CaptureState {
    enabled: AtomicBool,
    prefix: Mutex<Vec<u8>>,
}

/// Owned by the constructor, not the probe worker. Drop on any early return
/// (including timeout) frees captured bytes even if that worker is blocked in I/O.
pub(super) struct LayoutCapture(Arc<CaptureState>);

impl LayoutCapture {
    pub(super) fn wrap(inner: Box<dyn MediaSource>) -> (Box<dyn MediaSource>, Self) {
        let state = Arc::new(CaptureState {
            enabled: AtomicBool::new(true),
            prefix: Mutex::new(Vec::new()),
        });
        let source = CaptureSource {
            inner,
            state: state.clone(),
            offset: 0,
        };
        (Box::new(source), Self(state))
    }

    pub(super) fn finish(self, info: &mut ResolvedCodecInfo, decoded_channels: Option<usize>) {
        let prefix = self.take_prefix();
        info.channel_layout =
            verify_channel_layout(info.codec_name, info.channels, decoded_channels, &prefix);
    }

    fn take_prefix(&self) -> Vec<u8> {
        self.0.enabled.store(false, Ordering::Release);
        std::mem::take(&mut *self.0.prefix.lock().unwrap_or_else(|p| p.into_inner()))
    }
}

impl Drop for LayoutCapture {
    fn drop(&mut self) {
        self.take_prefix();
    }
}

struct CaptureSource {
    inner: Box<dyn MediaSource>,
    state: Arc<CaptureState>,
    offset: u64,
}

impl CaptureSource {
    fn invalidate(&self) {
        self.state.enabled.store(false, Ordering::Release);
        *self.state.prefix.lock().unwrap_or_else(|p| p.into_inner()) = Vec::new();
    }

    fn observe(&mut self, bytes: &[u8]) {
        if !self.state.enabled.load(Ordering::Acquire) {
            return;
        }
        let mut prefix = self.state.prefix.lock().unwrap_or_else(|p| p.into_inner());
        // A timeout can disable capture while the underlying read is blocked.
        if !self.state.enabled.load(Ordering::Acquire) {
            return;
        }
        let Ok(start) = usize::try_from(self.offset) else {
            drop(prefix);
            self.invalidate();
            return;
        };
        if start > prefix.len() {
            drop(prefix);
            self.invalidate();
            return;
        }
        let len = bytes.len().min(MAX_CAPTURE_BYTES - start);
        let overlap = len.min(prefix.len() - start);
        if prefix[start..start + overlap] != bytes[..overlap] {
            drop(prefix);
            self.invalidate();
            return;
        }
        let end = start + len;
        if end > prefix.capacity() {
            // Geometric growth, but never reserve beyond the fixed memory cap.
            let capacity = end
                .max(prefix.capacity().max(4096) * 2)
                .min(MAX_CAPTURE_BYTES);
            let additional = capacity - prefix.len();
            prefix.reserve_exact(additional);
        }
        prefix.extend_from_slice(&bytes[overlap..len]);
        if prefix.len() == MAX_CAPTURE_BYTES {
            self.state.enabled.store(false, Ordering::Release);
        }
    }
}

impl Read for CaptureSource {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        // Exactly one unchanged underlying read, with no state lock across I/O.
        // Disabled playback reads do not touch the mutex (or track positions).
        if !self.state.enabled.load(Ordering::Acquire) {
            return self.inner.read(buf);
        }
        match self.inner.read(buf) {
            Ok(n) => {
                if n != 0 {
                    self.observe(&buf[..n]);
                    if let Some(offset) = self.offset.checked_add(n as u64) {
                        self.offset = offset;
                    } else {
                        self.invalidate();
                    }
                }
                Ok(n)
            }
            Err(error) => {
                self.invalidate();
                Err(error)
            }
        }
    }
}

impl Seek for CaptureSource {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        let result = self.inner.seek(pos);
        if self.state.enabled.load(Ordering::Acquire) {
            match &result {
                Ok(offset) => self.offset = *offset,
                Err(_) => self.invalidate(),
            }
        }
        result
    }
}

impl MediaSource for CaptureSource {
    fn is_seekable(&self) -> bool {
        self.inner.is_seekable()
    }
    fn byte_len(&self) -> Option<u64> {
        self.inner.byte_len()
    }
}

#[cfg(test)]
#[path = "tests/channel_layout_capture_unit.rs"]
mod tests;
