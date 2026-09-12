//! Decode → Red Book PCM.
//!
//! Turns any file the player can open into raw 44 100 Hz / 16-bit / stereo
//! interleaved little-endian PCM on disk, padded out to a whole number of
//! 2352-byte sectors. That file is exactly what IMAPI2 wants as a track
//! stream, and what a CD sector physically holds.
//!
//! Streaming throughout: a 9-minute track never materialises as one big
//! buffer. Memory stays bounded by the resampler chunk size.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use symphonia::core::codecs::audio::{AudioDecoder, AudioDecoderOptions};
use symphonia::core::codecs::registry::CodecRegistry;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, FormatReader, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

use crate::model::{BYTES_PER_AUDIO_SECTOR, CD_CHANNELS, CD_SAMPLE_RATE, FRAMES_PER_SECTOR};

/// Frames handed to the resampler at a time. 1024 keeps the working set small
/// while staying well above the sinc kernel length.
const RESAMPLE_CHUNK: usize = 1024;

/// A track rendered to disc-ready PCM.
#[derive(Debug, Clone)]
pub struct RenderedTrack {
    /// Temp file holding raw interleaved s16le, sector-aligned.
    pub path: PathBuf,
    /// Length in CD sectors.
    pub sectors: u32,
    /// ISRC to stamp into the subchannel, when the library knows one.
    pub isrc: Option<String>,
    /// Track title, for the CD-TEXT lead-in.
    pub title: String,
    /// Track performer, for the CD-TEXT lead-in.
    pub artist: String,
}

/// Loudness measurement for one track, used to level a mixed-source disc.
#[derive(Debug, Clone, Copy)]
pub struct TrackLoudness {
    /// Integrated loudness (LUFS).
    pub lufs: f64,
    /// Highest absolute sample seen, in linear scale.
    pub peak: f32,
}

/// Symphonia codec registry, mirroring the player's so anything that plays
/// can also be burned.
fn codec_registry() -> &'static CodecRegistry {
    use std::sync::OnceLock;
    static REGISTRY: OnceLock<CodecRegistry> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        let mut registry = CodecRegistry::new();
        symphonia::default::register_enabled_codecs(&mut registry);
        registry
    })
}

struct DecodeSession {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn AudioDecoder>,
    track_id: u32,
}

fn open_decode_session(path: &Path) -> Result<DecodeSession, String> {
    let file = File::open(path).map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let format = symphonia::default::get_probe()
        .probe(
            &hint,
            mss,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|e| format!("unrecognised audio format: {e}"))?;

    // Prefer a track that declares both rate and channels; fall back to the
    // first known audio codec so cover-art video tracks are skipped.
    let track = format
        .tracks()
        .iter()
        .find(|t| {
            t.codec_params
                .as_ref()
                .and_then(|c| c.audio())
                .is_some_and(|a| a.sample_rate.is_some() && a.channels.is_some())
        })
        .or_else(|| format.first_track_known_codec(TrackType::Audio))
        .ok_or_else(|| "file contains no decodable audio track".to_string())?;

    let track_id = track.id;
    let params = track
        .codec_params
        .as_ref()
        .and_then(|c| c.audio())
        .ok_or_else(|| "audio track has no codec parameters".to_string())?
        .clone();

    let decoder = codec_registry()
        .make_audio_decoder(&params, &AudioDecoderOptions::default().gapless(true))
        .map_err(|e| format!("no decoder for this codec: {e}"))?;

    Ok(DecodeSession {
        format,
        decoder,
        track_id,
    })
}

/// Fold an arbitrary channel layout down to a stereo pair.
///
/// Mono is duplicated. Stereo passes through. Anything wider takes the front
/// L/R pair, which is what every consumer CD burner does — a proper downmix
/// would need the channel map and a matrix, and guessing one silently would
/// be worse than using the front pair.
#[inline]
fn fold_to_stereo(frame: &[f32], channels: usize) -> (f32, f32) {
    match channels {
        0 => (0.0, 0.0),
        1 => (frame[0], frame[0]),
        _ => (frame[0], frame[1]),
    }
}

/// Measure integrated loudness and true peak without writing anything.
///
/// Only called when the user asked for normalisation, because it costs a full
/// extra decode pass.
pub fn measure_loudness(path: &Path, cancel: &AtomicBool) -> Result<TrackLoudness, String> {
    let DecodeSession {
        mut format,
        mut decoder,
        track_id,
    } = open_decode_session(path)?;

    let mut meter: Option<ebur128::EbuR128> = None;
    let mut peak = 0.0_f32;
    let mut interleaved: Vec<f32> = Vec::new();
    let mut stereo: Vec<f32> = Vec::new();
    let mut yields: u32 = 0;

    // Symphonia distinguishes three outcomes here and so must this loop:
    // `Ok(None)` is the end of the media, `Err(ResetRequired)` means the
    // container changed shape and every decoder built from it is now invalid,
    // and the docs say plainly that "all other errors are unrecoverable". The
    // `while let Ok(Some(..))` this replaces collapsed all three into "stop
    // here", with no error set — so a file that failed to read halfway through
    // was written to the disc as a short track and reported as a successful
    // burn, on media that cannot be rewritten.
    let mut needs_reset = false;
    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            Err(SymphoniaError::ResetRequired) => {
                return Err("the file changes format partway through; cannot burn".to_string())
            }
            Err(e) => return Err(format!("could not read the audio stream: {e}")),
        };
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".to_string());
        }
        if packet.track_id != track_id {
            continue;
        }
        if needs_reset {
            // A discontinuity, not a failure: symphonia asks for a reset and
            // the next packet decodes normally. Breaking here truncated a
            // chained stream at its first join.
            decoder.reset();
            needs_reset = false;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(buf) => buf,
            // The one error symphonia documents as recoverable: a malformed
            // packet, skipped so the rest of the track still burns.
            Err(SymphoniaError::DecodeError(_)) => continue,
            // Cannot reset in this arm — `decoded` borrows the decoder for the
            // whole match, so the reset happens at the top of the next pass.
            Err(SymphoniaError::ResetRequired) => {
                needs_reset = true;
                continue;
            }
            Err(e) => return Err(format!("could not decode the audio: {e}")),
        };
        let channels = decoded.spec().channels().count();
        let rate = decoded.spec().rate();
        if channels == 0 || rate == 0 {
            continue;
        }
        if meter.is_none() {
            meter = Some(
                ebur128::EbuR128::new(CD_CHANNELS as u32, rate, ebur128::Mode::I)
                    .map_err(|e| format!("loudness meter init failed: {e:?}"))?,
            );
        }

        decoded.copy_to_vec_interleaved(&mut interleaved);
        if interleaved.len() < channels || !interleaved.len().is_multiple_of(channels) {
            continue;
        }

        stereo.clear();
        for frame in interleaved.chunks_exact(channels) {
            let (l, r) = fold_to_stereo(frame, channels);
            peak = peak.max(l.abs()).max(r.abs());
            stereo.push(l);
            stereo.push(r);
        }
        if let Some(meter) = meter.as_mut() {
            meter
                .add_frames_f32(&stereo)
                .map_err(|e| format!("loudness measurement failed: {e:?}"))?;
        }

        yields = yields.wrapping_add(1);
        if yields.is_multiple_of(128) {
            std::thread::yield_now();
        }
    }

    let meter = meter.ok_or_else(|| "no audio decoded".to_string())?;
    let lufs = meter
        .loudness_global()
        .map_err(|e| format!("loudness result unavailable: {e:?}"))?;

    Ok(TrackLoudness { lufs, peak })
}

/// Build a resampler when the source rate is not already 44 100 Hz.
fn make_resampler(source_rate: u32) -> Result<Option<rubato::SincFixedIn<f32>>, String> {
    if source_rate == CD_SAMPLE_RATE {
        return Ok(None);
    }
    let params = rubato::SincInterpolationParameters {
        sinc_len: 256,
        f_cutoff: 0.95,
        interpolation: rubato::SincInterpolationType::Linear,
        oversampling_factor: 256,
        window: rubato::WindowFunction::BlackmanHarris2,
    };
    let ratio = f64::from(CD_SAMPLE_RATE) / f64::from(source_rate);
    rubato::SincFixedIn::<f32>::new(ratio, 1.0, params, RESAMPLE_CHUNK, CD_CHANNELS)
        .map(Some)
        .map_err(|e| format!("resampler init failed ({source_rate} Hz → 44 100 Hz): {e}"))
}

/// TPDF dither: two independent uniform randoms summed, giving a triangular
/// distribution one LSB wide. Removes the correlated distortion plain
/// truncation leaves on quiet passages.
struct Dither {
    state: u32,
}

impl Dither {
    fn new() -> Self {
        Self { state: 0x1234_5678 }
    }

    /// xorshift32 — fast, and more than random enough for dither.
    #[inline]
    fn next_uniform(&mut self) -> f32 {
        self.state ^= self.state << 13;
        self.state ^= self.state >> 17;
        self.state ^= self.state << 5;
        (self.state as f32 / u32::MAX as f32) - 0.5
    }

    /// f32 in [-1, 1] → dithered, clamped i16.
    #[inline]
    fn quantize(&mut self, sample: f32) -> i16 {
        const SCALE: f32 = 32767.0;
        let tpdf = self.next_uniform() + self.next_uniform();
        let scaled = sample * SCALE + tpdf;
        scaled.clamp(-32768.0, 32767.0).round() as i16
    }
}

/// Writes s16le frames and tracks how many it has taken.
struct SectorWriter {
    out: BufWriter<File>,
    frames: u64,
    dither: Dither,
    gain: f32,
}

impl SectorWriter {
    fn new(path: &Path, gain: f32) -> Result<Self, String> {
        let file = File::create(path)
            .map_err(|e| format!("cannot create render file {}: {e}", path.display()))?;
        Ok(Self {
            out: BufWriter::with_capacity(1 << 18, file),
            frames: 0,
            dither: Dither::new(),
            gain,
        })
    }

    fn write_frames(&mut self, left: &[f32], right: &[f32]) -> Result<(), String> {
        let mut bytes = Vec::with_capacity(left.len() * 4);
        for (l, r) in left.iter().zip(right.iter()) {
            let l = self.dither.quantize(l * self.gain);
            let r = self.dither.quantize(r * self.gain);
            bytes.extend_from_slice(&l.to_le_bytes());
            bytes.extend_from_slice(&r.to_le_bytes());
        }
        self.out
            .write_all(&bytes)
            .map_err(|e| format!("render write failed: {e}"))?;
        self.frames += left.len() as u64;
        Ok(())
    }

    /// Pad with digital silence so the track ends on a sector boundary, then
    /// flush. Without this the next track starts mid-sector and clicks.
    fn finish(mut self) -> Result<u32, String> {
        let remainder = (self.frames as usize) % FRAMES_PER_SECTOR;
        if remainder != 0 {
            let pad_frames = FRAMES_PER_SECTOR - remainder;
            let silence = vec![0_u8; pad_frames * 4];
            self.out
                .write_all(&silence)
                .map_err(|e| format!("render padding failed: {e}"))?;
            self.frames += pad_frames as u64;
        }
        self.out
            .flush()
            .map_err(|e| format!("render flush failed: {e}"))?;
        Ok((self.frames as usize / FRAMES_PER_SECTOR) as u32)
    }
}

/// Decode `source` into disc-ready PCM at `dest`.
///
/// `gain` is a linear multiplier applied before dithering — `1.0` for the
/// untouched signal, or the shared disc gain when normalisation is on.
///
/// `on_frames` is called with the number of frames written since the previous
/// call, often enough to drive a progress bar. Rendering a full disc takes
/// minutes; without this the UI could only move once per track, which reads as
/// a hang rather than as work. It is called from the rendering thread, so it
/// must be cheap and must not block.
pub fn render_track(
    source: &Path,
    dest: &Path,
    gain: f32,
    cancel: &AtomicBool,
    on_frames: &(dyn Fn(u64) + Sync),
) -> Result<RenderedTrack, String> {
    let DecodeSession {
        mut format,
        mut decoder,
        track_id,
    } = open_decode_session(source)?;

    let mut writer = SectorWriter::new(dest, gain)?;
    let mut resampler: Option<rubato::SincFixedIn<f32>> = None;
    let mut source_rate: u32 = 0;

    // Deinterleaved staging buffers the resampler consumes in fixed chunks.
    let mut pending: [Vec<f32>; CD_CHANNELS] = [Vec::new(), Vec::new()];
    let mut interleaved: Vec<f32> = Vec::new();
    let mut yields: u32 = 0;

    // Symphonia distinguishes three outcomes here and so must this loop:
    // `Ok(None)` is the end of the media, `Err(ResetRequired)` means the
    // container changed shape and every decoder built from it is now invalid,
    // and the docs say plainly that "all other errors are unrecoverable". The
    // `while let Ok(Some(..))` this replaces collapsed all three into "stop
    // here", with no error set — so a file that failed to read halfway through
    // was written to the disc as a short track and reported as a successful
    // burn, on media that cannot be rewritten.
    let mut needs_reset = false;
    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            Err(SymphoniaError::ResetRequired) => {
                return Err("the file changes format partway through; cannot burn".to_string())
            }
            Err(e) => return Err(format!("could not read the audio stream: {e}")),
        };
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".to_string());
        }
        if packet.track_id != track_id {
            continue;
        }
        if needs_reset {
            // A discontinuity, not a failure: symphonia asks for a reset and
            // the next packet decodes normally. Breaking here truncated a
            // chained stream at its first join.
            decoder.reset();
            needs_reset = false;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(buf) => buf,
            // The one error symphonia documents as recoverable: a malformed
            // packet, skipped so the rest of the track still burns.
            Err(SymphoniaError::DecodeError(_)) => continue,
            // Cannot reset in this arm — `decoded` borrows the decoder for the
            // whole match, so the reset happens at the top of the next pass.
            Err(SymphoniaError::ResetRequired) => {
                needs_reset = true;
                continue;
            }
            Err(e) => return Err(format!("could not decode the audio: {e}")),
        };
        let channels = decoded.spec().channels().count();
        let rate = decoded.spec().rate();
        if channels == 0 || rate == 0 {
            continue;
        }
        if source_rate == 0 {
            source_rate = rate;
            resampler = make_resampler(source_rate)?;
        } else if rate != source_rate {
            // Mid-file rate changes would desync the resampler. Symphonia only
            // surfaces these for pathological files; refuse rather than emit
            // pitch-shifted audio onto a disc that cannot be rewritten.
            return Err(format!(
                "sample rate changes mid-file ({source_rate} Hz → {rate} Hz); cannot burn"
            ));
        }

        decoded.copy_to_vec_interleaved(&mut interleaved);
        if interleaved.len() < channels || !interleaved.len().is_multiple_of(channels) {
            continue;
        }

        for frame in interleaved.chunks_exact(channels) {
            let (l, r) = fold_to_stereo(frame, channels);
            pending[0].push(l);
            pending[1].push(r);
        }

        let before = writer.frames;
        drain_pending(&mut pending, resampler.as_mut(), &mut writer, false)?;
        let written = writer.frames - before;
        if written > 0 {
            on_frames(written);
        }

        yields = yields.wrapping_add(1);
        if yields.is_multiple_of(64) {
            std::thread::yield_now();
        }
    }

    if source_rate == 0 {
        return Err("no audio decoded".to_string());
    }

    // Flush whatever is left, including the resampler's internal delay line.
    let before = writer.frames;
    drain_pending(&mut pending, resampler.as_mut(), &mut writer, true)?;
    let written = writer.frames - before;
    if written > 0 {
        on_frames(written);
    }

    let sectors = writer.finish()?;
    if sectors == 0 {
        return Err("decoded to zero sectors".to_string());
    }

    Ok(RenderedTrack {
        path: dest.to_path_buf(),
        sectors,
        isrc: None,
        title: String::new(),
        artist: String::new(),
    })
}

/// Push staged frames through the resampler (or straight out when the source
/// is already 44 100 Hz) until fewer than one chunk remains.
///
/// With `flush`, the tail is zero-padded to one full chunk so the resampler
/// emits its delay line; the extra frames are the sub-sector padding
/// `SectorWriter::finish` would add anyway.
fn drain_pending(
    pending: &mut [Vec<f32>; CD_CHANNELS],
    mut resampler: Option<&mut rubato::SincFixedIn<f32>>,
    writer: &mut SectorWriter,
    flush: bool,
) -> Result<(), String> {
    use rubato::Resampler;

    let Some(resampler) = resampler.as_mut() else {
        // Native 44.1 kHz — no conversion, just hand the frames over.
        if !pending[0].is_empty() {
            let (left, right) = pending.split_at_mut(1);
            writer.write_frames(&left[0], &right[0])?;
            left[0].clear();
            right[0].clear();
        }
        return Ok(());
    };

    loop {
        let needed = resampler.input_frames_next();
        if pending[0].len() < needed {
            if !flush || pending[0].is_empty() {
                return Ok(());
            }
            // Final short chunk: pad to the chunk size with silence.
            for channel in pending.iter_mut() {
                channel.resize(needed, 0.0);
            }
        }

        let chunk: Vec<&[f32]> = pending.iter().map(|c| &c[..needed]).collect();
        let out = resampler
            .process(&chunk, None)
            .map_err(|e| format!("resampling failed: {e}"))?;
        if out.len() >= CD_CHANNELS {
            writer.write_frames(&out[0], &out[1])?;
        }
        for channel in pending.iter_mut() {
            channel.drain(..needed);
        }
        if flush {
            return Ok(());
        }
    }
}

/// Gain that brings `lufs` to `target_lufs`, held back so no track clips.
///
/// Returns a linear multiplier. `peak` is the loudest sample on the disc, so
/// the whole disc keeps one gain and the relative balance the user expects.
pub fn normalization_gain(lufs: f64, peak: f32, target_lufs: f64) -> f32 {
    if !lufs.is_finite() || lufs <= -70.0 {
        return 1.0; // Silent or unmeasurable — leave it alone.
    }
    let desired = 10.0_f64.powf((target_lufs - lufs) / 20.0) as f32;
    if peak <= 0.0 {
        return desired;
    }
    // Never push the loudest sample past full scale; leave a hair of headroom
    // so dither and inter-sample peaks have somewhere to go.
    let ceiling = 0.999 / peak;
    desired.min(ceiling).clamp(0.05, 20.0)
}

/// Bytes one rendered track occupies on disc.
pub fn sectors_to_bytes(sectors: u32) -> u64 {
    u64::from(sectors) * BYTES_PER_AUDIO_SECTOR as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal 44.1 kHz 16-bit stereo WAV, `frames` long.
    ///
    /// Built here rather than checked in as a fixture so the expected sector
    /// count is arithmetic the test states out loud, not a property of a
    /// binary nobody can read in a diff.
    fn wav_bytes(frames: u32) -> Vec<u8> {
        let data_len = frames * 4;
        let mut out = Vec::with_capacity(44 + data_len as usize);
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data_len).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&2u16.to_le_bytes());
        out.extend_from_slice(&44_100u32.to_le_bytes());
        out.extend_from_slice(&(44_100u32 * 4).to_le_bytes());
        out.extend_from_slice(&4u16.to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&data_len.to_le_bytes());
        for i in 0..frames {
            let v = ((i % 1000) as i16).wrapping_mul(8);
            out.extend_from_slice(&v.to_le_bytes());
            out.extend_from_slice(&v.to_le_bytes());
        }
        out
    }

    #[test]
    fn a_whole_wav_renders_to_the_sector_count_its_length_implies() {
        let dir = tempfile::tempdir().expect("tempdir");
        let src = dir.path().join("a.wav");
        let dest = dir.path().join("a.pcm");
        // Exactly one second: 44 100 frames x 4 bytes = 176 400 = 75 sectors.
        std::fs::write(&src, wav_bytes(44_100)).expect("write wav");

        let cancel = AtomicBool::new(false);
        let track = render_track(&src, &dest, 1.0, &cancel, &|_: u64| {}).expect("render");
        assert_eq!(track.sectors, 75);
    }

    #[test]
    fn a_source_that_stops_early_fails_instead_of_burning_short() {
        // The bug this pins reached a disc. The decode loop was
        // `while let Ok(Some(..))`, so a read failure partway through ended it
        // with no error set; the short result then passed the `sectors > 0`
        // guard and was reported as a successful burn, on media that cannot be
        // rewritten. Symphonia's contract is that `Ok(None)` is the end of the
        // media and every error but `ResetRequired` is unrecoverable.
        let dir = tempfile::tempdir().expect("tempdir");
        let src = dir.path().join("cut.wav");
        let dest = dir.path().join("cut.pcm");
        let mut bytes = wav_bytes(44_100);
        // The header still promises a full second; half the samples are gone.
        bytes.truncate(44 + 44_100 * 2);
        std::fs::write(&src, bytes).expect("write wav");

        let cancel = AtomicBool::new(false);
        let result = render_track(&src, &dest, 1.0, &cancel, &|_: u64| {});
        assert!(
            result.is_err(),
            "a source that ends early must not render as a whole track: {result:?}"
        );
    }

    #[test]
    fn mono_is_duplicated_across_both_channels() {
        assert_eq!(fold_to_stereo(&[0.5], 1), (0.5, 0.5));
    }

    #[test]
    fn stereo_passes_through_untouched() {
        assert_eq!(fold_to_stereo(&[0.25, -0.75], 2), (0.25, -0.75));
    }

    #[test]
    fn surround_takes_the_front_pair() {
        assert_eq!(fold_to_stereo(&[0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 6), (0.1, 0.2));
    }

    #[test]
    fn samples_past_full_scale_saturate_instead_of_wrapping() {
        // 1.5 scales to ~49 150, well past i16. Without the clamp this would
        // wrap to a large negative value — a loud click on the disc.
        let mut dither = Dither::new();
        for _ in 0..10_000 {
            assert_eq!(dither.quantize(1.5), i16::MAX);
            assert_eq!(dither.quantize(-1.5), i16::MIN);
        }
    }

    #[test]
    fn full_scale_input_lands_at_the_top_of_the_range() {
        let mut dither = Dither::new();
        // Dither can nudge by one LSB either way, so allow a hair of slack.
        let value = dither.quantize(1.0);
        assert!(value >= 32_765, "expected near full scale, got {value}");
    }

    #[test]
    fn dither_is_centred_and_roughly_one_lsb_wide() {
        let mut dither = Dither::new();
        let mut sum = 0.0_f64;
        let mut max = f32::MIN;
        for _ in 0..100_000 {
            let v = dither.next_uniform() + dither.next_uniform();
            sum += f64::from(v);
            max = max.max(v.abs());
        }
        let mean = sum / 100_000.0;
        assert!(mean.abs() < 0.02, "TPDF should be zero-mean, got {mean}");
        assert!(max <= 1.0, "TPDF should span at most one LSB, got {max}");
    }

    #[test]
    fn quiet_tracks_are_brought_up_toward_the_target() {
        let gain = normalization_gain(-23.0, 0.3, -14.0);
        assert!(gain > 1.0, "a -23 LUFS track should be raised, got {gain}");
    }

    #[test]
    fn normalization_never_clips_a_hot_master() {
        // Already at full scale: any upward gain would clip, so it must not.
        let gain = normalization_gain(-20.0, 1.0, -14.0);
        assert!(gain <= 1.0, "gain {gain} would clip a full-scale peak");
    }

    #[test]
    fn silence_is_left_alone() {
        assert_eq!(normalization_gain(-70.0, 0.0, -14.0), 1.0);
        assert_eq!(normalization_gain(f64::NEG_INFINITY, 0.0, -14.0), 1.0);
    }

    #[test]
    fn sector_byte_math_matches_red_book() {
        // One second of CD audio is 75 sectors = 176 400 bytes.
        assert_eq!(sectors_to_bytes(75), 176_400);
        assert_eq!(FRAMES_PER_SECTOR * 4, BYTES_PER_AUDIO_SECTOR);
    }
}
