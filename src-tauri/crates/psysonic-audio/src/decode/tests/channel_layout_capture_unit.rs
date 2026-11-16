use std::io::Cursor;
use std::sync::Barrier;
use std::time::Duration;

use super::*;
use crate::decode::format::resolve_codec_info;
use crate::decode::test_support::extensible_wav;

#[derive(Clone, Debug, PartialEq, Eq)]
enum Operation {
    Read(usize, usize),
    Seek(SeekFrom),
}

#[derive(Default)]
struct Observations {
    operations: Mutex<Vec<Operation>>,
    read_error: AtomicBool,
    seek_error: AtomicBool,
    capture: Mutex<Option<Arc<CaptureState>>>,
}

struct ObservedSource {
    cursor: Cursor<Vec<u8>>,
    observed: Arc<Observations>,
    fragment: usize,
    block_second_read: Option<(Arc<Barrier>, Arc<Barrier>)>,
    reads: usize,
}

impl Read for ObservedSource {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        self.reads += 1;
        self.observed
            .operations
            .lock()
            .unwrap()
            .push(Operation::Read(buffer.len(), buffer.as_ptr() as usize));
        if let Some(state) = self.observed.capture.lock().unwrap().as_ref() {
            assert!(
                state.prefix.try_lock().is_ok(),
                "capture must never lock across I/O"
            );
        }
        if self.reads == 2 {
            if let Some((entered, release)) = &self.block_second_read {
                entered.wait();
                release.wait();
            }
        }
        if self.observed.read_error.load(Ordering::Relaxed) {
            return Err(io::Error::new(
                io::ErrorKind::ConnectionReset,
                "test read error",
            ));
        }
        let len = buffer.len().min(self.fragment);
        self.cursor.read(&mut buffer[..len])
    }
}

impl Seek for ObservedSource {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        if let Some(state) = self.observed.capture.lock().unwrap().as_ref() {
            assert!(
                state.prefix.try_lock().is_ok(),
                "capture must never lock across I/O"
            );
        }
        self.observed
            .operations
            .lock()
            .unwrap()
            .push(Operation::Seek(position));
        if self.observed.seek_error.load(Ordering::Relaxed) {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "test seek error",
            ));
        }
        self.cursor.seek(position)
    }
}

impl MediaSource for ObservedSource {
    fn is_seekable(&self) -> bool {
        true
    }
    fn byte_len(&self) -> Option<u64> {
        Some(self.cursor.get_ref().len() as u64)
    }
}

fn wrapped(
    bytes: Vec<u8>,
    fragment: usize,
) -> (Box<dyn MediaSource>, LayoutCapture, Arc<Observations>) {
    let observed = Arc::new(Observations::default());
    let inner = ObservedSource {
        cursor: Cursor::new(bytes),
        observed: observed.clone(),
        fragment,
        block_second_read: None,
        reads: 0,
    };
    let (source, capture) = LayoutCapture::wrap(Box::new(inner));
    *observed.capture.lock().unwrap() = Some(capture.0.clone());
    (source, capture, observed)
}

#[test]
fn capture_forwards_one_unchanged_read_and_each_existing_seek() {
    let data: Vec<u8> = (0..64).collect();
    let (mut source, capture, observed) = wrapped(data.clone(), usize::MAX);
    assert!(source.is_seekable());
    assert_eq!(source.byte_len(), Some(64));
    let mut buffer = [0; 16];
    let ptr = buffer.as_ptr() as usize;
    assert_eq!(source.read(&mut buffer).unwrap(), 16);
    assert_eq!(buffer, data[..16]);
    assert_eq!(source.seek(SeekFrom::Start(4)).unwrap(), 4);
    assert_eq!(source.read(&mut buffer).unwrap(), 16);
    assert_eq!(buffer, data[4..20]);
    assert_eq!(source.stream_position().unwrap(), 20);
    assert_eq!(source.seek(SeekFrom::End(-44)).unwrap(), 20);
    assert_eq!(
        *observed.operations.lock().unwrap(),
        vec![
            Operation::Read(16, ptr),
            Operation::Seek(SeekFrom::Start(4)),
            Operation::Read(16, ptr),
            Operation::Seek(SeekFrom::Current(0)),
            Operation::Seek(SeekFrom::End(-44)),
        ]
    );
    assert_eq!(capture.take_prefix(), data[..20]);
}

#[test]
fn fragmented_reads_retain_only_the_contiguous_prefix() {
    for fragment in [1, 3, 17, 8191] {
        let data = extensible_wav(6, 0x3f, 64);
        let (mut source, capture, _) = wrapped(data.clone(), fragment);
        let mut out = Vec::new();
        source.read_to_end(&mut out).unwrap();
        assert_eq!(out, data);
        assert_eq!(capture.take_prefix(), data);
    }
}

#[test]
fn gaps_in_observed_bytes_and_failed_seeks_disable_and_free_capture() {
    for first in [0, 8] {
        let (mut source, capture, _) = wrapped(vec![1; 128], usize::MAX);
        let state = capture.0.clone();
        source.read_exact(&mut vec![0; first]).unwrap();
        source.seek(SeekFrom::Start(32)).unwrap();
        assert_eq!(source.read(&mut [0; 8]).unwrap(), 8);
        assert!(!state.enabled.load(Ordering::Acquire));
        assert_eq!(state.prefix.lock().unwrap().capacity(), 0);
        assert!(capture.take_prefix().is_empty());
    }
    let (mut source, capture, observed) = wrapped(vec![1; 128], usize::MAX);
    source.read_exact(&mut [0; 8]).unwrap();
    observed.seek_error.store(true, Ordering::Relaxed);
    let error = source.seek(SeekFrom::Start(0)).unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::Unsupported);
    assert_eq!(error.to_string(), "test seek error");
    assert!(capture.take_prefix().is_empty());
}

#[test]
fn read_errors_are_forwarded_without_retry_and_release_storage() {
    let (mut source, capture, observed) = wrapped(vec![1; 128], usize::MAX);
    source.read_exact(&mut [0; 8]).unwrap();
    observed.read_error.store(true, Ordering::Relaxed);
    let error = source.read(&mut [0; 8]).unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::ConnectionReset);
    assert_eq!(error.to_string(), "test read error");
    assert_eq!(observed.operations.lock().unwrap().len(), 2);
    assert_eq!(capture.0.prefix.lock().unwrap().capacity(), 0);
    assert!(capture.take_prefix().is_empty());
}

#[test]
fn large_reads_and_fragmented_growth_never_retain_more_than_one_mib() {
    for fragment in [usize::MAX, 700_000, 77_777] {
        let (mut source, capture, _) = wrapped(vec![1; MAX_CAPTURE_BYTES * 2], fragment);
        let mut buffer = vec![0; MAX_CAPTURE_BYTES * 2];
        while capture.0.enabled.load(Ordering::Acquire) {
            assert!(source.read(&mut buffer).unwrap() > 0);
            let prefix = capture.0.prefix.lock().unwrap();
            assert!(prefix.len() <= MAX_CAPTURE_BYTES);
            assert!(prefix.capacity() <= MAX_CAPTURE_BYTES);
        }
        assert_eq!(capture.0.prefix.lock().unwrap().len(), MAX_CAPTURE_BYTES);
        let state = capture.0.clone();
        drop(capture);
        assert_eq!(state.prefix.lock().unwrap().capacity(), 0);
    }
}

#[test]
fn successful_finish_and_early_error_drop_both_disable_and_release_capture() {
    for finish in [true, false] {
        let (mut source, capture, _) = wrapped(extensible_wav(6, 0x3f, 64), usize::MAX);
        let state = capture.0.clone();
        source.read_exact(&mut [0; 68]).unwrap();
        if finish {
            let mut params = symphonia::core::codecs::audio::AudioCodecParameters::new();
            params.codec = symphonia::core::codecs::audio::well_known::CODEC_ID_PCM_S16LE;
            params.channels = Some(symphonia::core::audio::Channels::Discrete(6));
            let mut info = resolve_codec_info(&params);
            capture.finish(&mut info, Some(6));
            assert!(info.channel_layout.is_some());
        } else {
            drop(capture); // Same RAII path used by constructor errors / spawn failure.
        }
        assert!(!state.enabled.load(Ordering::Acquire));
        assert_eq!(state.prefix.lock().unwrap().capacity(), 0);
    }
}

#[test]
fn timeout_drop_frees_prefix_while_probe_read_is_still_blocked() {
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let observed = Arc::new(Observations::default());
    let inner = ObservedSource {
        cursor: Cursor::new(vec![1; 128]),
        observed: observed.clone(),
        fragment: usize::MAX,
        block_second_read: Some((entered.clone(), release.clone())),
        reads: 0,
    };
    let (mut source, capture) = LayoutCapture::wrap(Box::new(inner));
    let state = capture.0.clone();
    *observed.capture.lock().unwrap() = Some(state.clone());
    source.read_exact(&mut [0; 8]).unwrap();
    let worker = std::thread::spawn(move || source.read(&mut [0; 8]));
    entered.wait();
    drop(capture); // Constructor's timeout does not own / join the blocked worker.
    assert_eq!(state.prefix.lock().unwrap().capacity(), 0);
    assert!(!state.enabled.load(Ordering::Acquire));
    release.wait();
    assert_eq!(worker.join().unwrap().unwrap(), 8);
    assert_eq!(
        state.prefix.lock().unwrap().capacity(),
        0,
        "late read must not recapture"
    );
}

#[test]
fn disabled_playback_reads_do_not_lock_capture_state() {
    let (mut source, capture, observed) = wrapped(vec![1; 128], usize::MAX);
    let state = capture.0.clone();
    drop(capture);
    // Disable the test source's own lock inspection; this test deliberately holds it.
    *observed.capture.lock().unwrap() = None;
    let lock = state.prefix.lock().unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        let result = source.read(&mut [0; 8]);
        tx.send(result).unwrap();
    });
    let result = rx.recv_timeout(Duration::from_secs(2));
    drop(lock);
    worker.join().unwrap();
    assert_eq!(result.unwrap().unwrap(), 8);
}
