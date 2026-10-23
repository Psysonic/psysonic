//! Read-only PipeWire clock discovery for ALSA's otherwise synthetic default.
//!
//! CPAL 0.17's ALSA default is a preference for 44.1 kHz, not the system clock.
//! `pw-metadata` is optional (like the existing `wpctl` integration); absent,
//! inaccessible or slow servers fall back to 48 kHz, checked against the actual
//! device's supported configurations by the caller. No server setting is written.

use rodio::cpal::traits::DeviceTrait;
use rodio::cpal::{Device, SupportedStreamConfig, SupportedStreamConfigRange};
use std::io::Read;
use std::os::fd::AsRawFd;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub(super) const FALLBACK_RATE: u32 = 48_000;
const QUERY_TIMEOUT: Duration = Duration::from_millis(300);
const MAX_QUERY_BYTES: usize = 16 * 1024;

/// The forced clock takes precedence over the default clock when active.
fn rate_from_settings(settings: &str) -> Option<u32> {
    let mut default = None;
    let mut forced = None;
    for line in settings.lines() {
        let line = line.trim();
        if !line.starts_with("update: id:0 ") {
            continue;
        }
        let Some((_, tail)) = line.split_once("key:'") else {
            continue;
        };
        let Some((key, tail)) = tail.split_once('\'') else {
            continue;
        };
        if !matches!(key, "clock.rate" | "clock.force-rate") {
            continue;
        }
        let Some((_, value)) = tail.split_once("value:'") else {
            continue;
        };
        let Some((value, _)) = value.split_once('\'') else {
            continue;
        };
        let rate = value
            .parse::<u32>()
            .ok()
            .filter(|rate| (8_000..=768_000).contains(rate));
        match key {
            "clock.rate" => default = rate,
            "clock.force-rate" => forced = rate,
            _ => {}
        }
    }
    forced.or(default)
}

// Bound both time and output; a missing/hung helper must not hold audio startup.
fn query(command: &mut Command, timeout: Duration) -> Option<String> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let result = (|| {
        let mut stdout = child.stdout.take()?;
        // We own the pipe. Nonblocking reads keep the deadline enforceable even
        // if the server/helper never closes stdout or fills its pipe buffer.
        let fd = stdout.as_raw_fd();
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
        if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
            return None;
        }
        let deadline = Instant::now() + timeout;
        let mut output = Vec::new();
        let mut buffer = [0; 1024];
        let mut status = None;
        loop {
            if Instant::now() >= deadline {
                return None;
            }
            match stdout.read(&mut buffer) {
                Ok(0) if status.is_some() => {
                    return status
                        .filter(|status: &std::process::ExitStatus| status.success())
                        .and_then(|_| String::from_utf8(output).ok());
                }
                Ok(0) => {}
                Ok(count) => {
                    if output.len() + count > MAX_QUERY_BYTES {
                        return None;
                    }
                    output.extend_from_slice(&buffer[..count]);
                    continue;
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => return None,
            }
            if status.is_none() {
                status = child.try_wait().ok()?;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    })();
    // Reap on every path, including timeout, invalid output and failed reads.
    let _ = child.kill();
    let _ = child.wait();
    result
}

pub(super) fn system_default_rate() -> u32 {
    query(
        Command::new("pw-metadata").args(["-n", "settings", "0"]),
        QUERY_TIMEOUT,
    )
    .as_deref()
    .and_then(rate_from_settings)
    .unwrap_or(FALLBACK_RATE)
}

fn select_default_config(
    default: SupportedStreamConfig,
    supported: impl Iterator<Item = SupportedStreamConfigRange>,
    preferred_rate: u32,
) -> SupportedStreamConfig {
    supported
        .filter(|config| {
            config.min_sample_rate() <= preferred_rate && preferred_rate <= config.max_sample_rate()
        })
        .max_by(|a, b| a.cmp_default_heuristics(b))
        .map(|config| config.with_sample_rate(preferred_rate))
        .unwrap_or(default)
}

pub(super) fn default_config(device: &Device) -> Result<SupportedStreamConfig, String> {
    let default = device
        .default_output_config()
        .map_err(|error| format!("failed to query default audio output configuration: {error}"))?;
    let Ok(supported) = device.supported_output_configs() else {
        return Ok(default);
    };
    Ok(select_default_config(
        default,
        supported,
        system_default_rate(),
    ))
}

pub(super) fn latency_hint(rate: u32) -> (String, String) {
    let frames = if rate > 48_000 { 8192 } else { 4096 };
    let millis = (f64::from(frames) / f64::from(rate.max(1)) * 1000.0).round() as u64;
    (format!("{frames}/{rate}"), millis.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn range(min: u32, max: u32, channels: u16) -> SupportedStreamConfigRange {
        SupportedStreamConfigRange::new(
            channels,
            min,
            max,
            rodio::cpal::SupportedBufferSize::Unknown,
            rodio::cpal::SampleFormat::F32,
        )
    }

    #[test]
    fn pipewire_clock_replaces_synthetic_44100_default_without_selecting_maximum() {
        let supported = range(1, 384_000, 2);
        let selected = select_default_config(
            supported.with_sample_rate(44_100),
            [range(1, 384_000, 1), supported].into_iter(),
            48_000,
        );
        assert_eq!(selected.sample_rate(), 48_000);
        assert_eq!(selected.channels(), 2);
    }

    #[test]
    fn honors_other_system_clocks_and_keeps_native_default_when_unsupported() {
        let supported = range(44_100, 192_000, 2);
        for rate in [44_100, 48_000, 96_000, 192_000] {
            assert_eq!(
                select_default_config(
                    supported.with_sample_rate(44_100),
                    [supported].into_iter(),
                    rate
                )
                .sample_rate(),
                rate
            );
        }
        let restricted = range(44_100, 44_100, 2);
        assert_eq!(
            select_default_config(
                restricted.with_sample_rate(44_100),
                [restricted].into_iter(),
                FALLBACK_RATE
            )
            .sample_rate(),
            44_100
        );
    }

    #[test]
    fn latency_uses_the_negotiated_stream_rate() {
        assert_eq!(latency_hint(48_000), ("4096/48000".into(), "85".into()));
        assert_eq!(latency_hint(44_100), ("4096/44100".into(), "93".into()));
        assert_eq!(latency_hint(96_000), ("8192/96000".into(), "85".into()));
    }

    #[test]
    fn reads_system_clock_instead_of_cpal_alsa_preference() {
        assert_eq!(rate_from_settings("update: id:0 key:'clock.rate' value:'48000' type:''\nupdate: id:0 key:'clock.force-rate' value:'0' type:''"), Some(48_000));
    }

    #[test]
    fn forced_clock_overrides_default_regardless_of_line_order() {
        for lines in [
            "update: id:0 key:'clock.rate' value:'48000' type:''\nupdate: id:0 key:'clock.force-rate' value:'96000' type:''",
            "update: id:0 key:'clock.force-rate' value:'96000' type:''\nupdate: id:0 key:'clock.rate' value:'48000' type:''",
        ] {
            assert_eq!(rate_from_settings(lines), Some(96_000));
        }
    }

    #[test]
    fn rejects_unrelated_invalid_and_non_root_metadata() {
        for line in [
            "",
            "clock.rate=48000",
            "update: id:1 key:'clock.rate' value:'48000' type:''",
            "update: id:0 key:'clock.rate' value:'0' type:''",
            "update: id:0 key:'clock.rate' value:'-1' type:''",
            "update: id:0 key:'clock.rate' value:'99999999' type:''",
            "update: id:0 key:'clock.quantum' value:'48000' type:''",
        ] {
            assert_eq!(rate_from_settings(line), None);
        }
    }

    #[test]
    fn bounded_query_reads_output_and_rejects_failure() {
        assert_eq!(
            query(
                Command::new("sh").args(["-c", "printf 'clock data'"]),
                Duration::from_secs(2)
            )
            .as_deref(),
            Some("clock data")
        );
        assert_eq!(
            query(
                Command::new("sh").args(["-c", "printf 'bad'; exit 1"]),
                Duration::from_secs(2)
            ),
            None
        );
    }

    #[test]
    fn bounded_query_reaps_slow_child_and_rejects_excess_output() {
        let started = Instant::now();
        assert_eq!(
            query(
                Command::new("sh").args(["-c", "exec sleep 10"]),
                Duration::from_millis(25)
            ),
            None
        );
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(
            query(
                Command::new("sh").args(["-c", "exec head -c 32768 /dev/zero"]),
                Duration::from_secs(2)
            ),
            None
        );
    }

    #[test]
    fn absent_command_is_a_safe_fallback() {
        assert_eq!(
            query(
                &mut Command::new("/nonexistent/psysonic-pw-metadata"),
                Duration::from_millis(25)
            ),
            None
        );
    }
}
