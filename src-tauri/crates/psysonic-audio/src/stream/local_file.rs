//! `LocalFileSource` — seekable `MediaSource` backed directly by `std::fs::File`.
//!
//! Used for `psysonic-local://` URLs (offline library + hot playback cache hits).
//! Lets Symphonia read on-demand from disk during the probe (~64 KB) instead of
//! the previous behaviour of `tokio::fs::read` blocking until the entire file
//! (often 100+ MB for hi-res FLAC) was loaded into RAM. Track-start is instant.

use std::io::{Read, Seek, SeekFrom};

use symphonia::core::io::MediaSource;

pub(crate) struct LocalFileSource {
    pub(crate) file: std::fs::File,
    pub(crate) len: u64,
}

impl Read for LocalFileSource {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.file.read(buf)
    }
}

impl Seek for LocalFileSource {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        self.file.seek(pos)
    }
}

impl MediaSource for LocalFileSource {
    fn is_seekable(&self) -> bool {
        true
    }
    fn byte_len(&self) -> Option<u64> {
        Some(self.len)
    }
}
