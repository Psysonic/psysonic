use std::fs::{File, FileTimes};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Move a file's mtime `seconds` into the past, for tests of age-based markers.
pub(super) fn age_file(path: &Path, seconds: u64) {
    let file = File::options().write(true).open(path).unwrap();
    let past = SystemTime::now() - Duration::from_secs(seconds);
    file.set_times(FileTimes::new().set_modified(past)).unwrap();
}

/// Build a unique tmpdir so parallel cover-cache tests don't trip on each other.
pub(super) fn fresh_tmpdir(label: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    path.push(format!("psysonic-cover-{label}-{nanos}"));
    std::fs::create_dir_all(&path).unwrap();
    path
}
