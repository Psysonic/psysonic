//! Position a private source before attaching it to the output callback.
//! A late blocking worker owns only its source: it cannot publish or unpause a player.

use std::time::Duration;

use rodio::Source;

use crate::preserve_worker::StreamingSeekHandle;

pub(crate) async fn position_source<S>(
    mut source: S,
    streaming_seek: Option<StreamingSeekHandle>,
    position: Duration,
    timeout: Duration,
) -> Result<S, String>
where
    S: Source<Item = f32> + Send + 'static,
{
    let worker = tokio::task::spawn_blocking(move || {
        let target = if let Some(handle) = streaming_seek {
            let ticket = handle
                .prepare_seek(position, Duration::ZERO, timeout)?
                .ok_or_else(|| "cold resume seek superseded".to_string())?;
            if let Some(error) = ticket.target_error() {
                return Err(format!("cold resume seek failed: {error}"));
            }
            ticket.commit_position()
        } else {
            position
        };
        source
            .try_seek(target)
            .map_err(|error| format!("cold resume seek failed: {error}"))?;
        Ok(source)
    });
    tokio::time::timeout(timeout, worker)
        .await
        .map_err(|_| "cold resume source seek timeout".to_string())?
        .map_err(|error| format!("cold resume worker failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::{ChannelCount, SampleRate};

    #[tokio::test]
    async fn positions_cached_pcm_before_consuming_samples() {
        let source = rodio::buffer::SamplesBuffer::new(
            ChannelCount::new(1).unwrap(),
            SampleRate::new(10).unwrap(),
            vec![0.0, 0.1, 0.2, 0.3, 0.4],
        );
        let mut positioned = position_source(
            source,
            None,
            Duration::from_millis(200),
            Duration::from_secs(1),
        )
        .await
        .unwrap();
        assert_eq!(positioned.next(), Some(0.2));
    }

    struct SlowSeek {
        unsupported: bool,
    }
    impl Iterator for SlowSeek {
        type Item = f32;
        fn next(&mut self) -> Option<f32> {
            Some(1.0)
        }
    }
    impl Source for SlowSeek {
        fn current_span_len(&self) -> Option<usize> {
            None
        }
        fn channels(&self) -> ChannelCount {
            ChannelCount::new(1).unwrap()
        }
        fn sample_rate(&self) -> SampleRate {
            SampleRate::new(10).unwrap()
        }
        fn total_duration(&self) -> Option<Duration> {
            None
        }
        fn try_seek(&mut self, _: Duration) -> Result<(), rodio::source::SeekError> {
            if self.unsupported {
                return Err(rodio::source::SeekError::NotSupported {
                    underlying_source: "test",
                });
            }
            std::thread::sleep(Duration::from_millis(80));
            Ok(())
        }
    }

    #[tokio::test]
    async fn slow_private_seek_fails_without_publishing_a_source() {
        let result = position_source(
            SlowSeek { unsupported: false },
            None,
            Duration::from_secs(5),
            Duration::from_millis(10),
        )
        .await;
        assert!(matches!(result, Err(error) if error == "cold resume source seek timeout"));
    }

    #[tokio::test]
    async fn unsupported_private_seek_is_not_silently_ignored() {
        let source = SlowSeek { unsupported: true };
        let result =
            position_source(source, None, Duration::from_secs(5), Duration::from_secs(1)).await;
        assert!(matches!(result, Err(error) if error.starts_with("cold resume seek failed:")));
    }

    #[tokio::test]
    async fn a_late_private_seek_cannot_overwrite_the_live_counter() {
        use crate::sources::{CountingSource, PriorityBoostSource};
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::sync::Arc;

        let live = Arc::new(AtomicU64::new(123));
        let private = Arc::new(AtomicU64::new(0));
        let mut source = PriorityBoostSource::new(CountingSource::new(
            SlowSeek { unsupported: false },
            live.clone(),
        ));
        source.replace_sample_counter(private.clone());
        let result = position_source(
            source,
            None,
            Duration::from_secs(5),
            Duration::from_millis(10),
        )
        .await;
        assert!(result.is_err());
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(private.load(Ordering::Relaxed), 50);
        assert_eq!(live.load(Ordering::Relaxed), 123);
    }
}
