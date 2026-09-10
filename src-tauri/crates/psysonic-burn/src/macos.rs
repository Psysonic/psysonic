//! macOS burn backend — `DiscRecording.framework`.
//!
//! The easy platform: the framework writes CD-TEXT itself, so none of the
//! hand-rolled MMC work the Windows path needs (`SEND CUE SHEET`, mode page
//! `05h`, raw P-W packing) exists here. We describe the disc and the framework
//! burns it.
//!
//! Three decisions worth knowing before reading:
//!
//! **Tracks are fed by a producer callback, not a file.** `DRTrackCreate` is
//! the only track constructor the SDK still exposes — the audio-file
//! convenience API (`DRAudioTrack`) is long gone — so the engine asks us for
//! bytes as it needs them. That suits us: [`crate::render`] already writes
//! headerless, sector-aligned Red Book PCM, which is exactly what the engine
//! wants, so nothing in the shared pipeline changes for macOS.
//!
//! **Progress is polled, not observed.** `DRBurnCopyStatus` can be read at any
//! time, which avoids a `DRNotificationCenter` observer and a run loop, and —
//! unlike the Windows event sink that silently swallowed every tick on the
//! first real burn — a poll cannot go quiet without the loop itself stopping.
//!
//! **CD-TEXT is transliterated before the framework sees it.** Handing the
//! framework `Żubr Kolektyw` yields `?ubr Kolektyw`: it substitutes rather
//! than transliterates. [`crate::cdtext::to_latin1`] gives `Zubr Kolektyw`,
//! which is the same small lie the Windows path tells and a better one than a
//! row of question marks burned onto a disc that cannot be rewritten.
//!
//! Capability gating matters more here than it looks. `kDRTrackISRCKey` and
//! `kDRCDTextKey` both fail the *whole burn* on a drive that cannot honour
//! them, so each is only attached once the drive's own write-capabilities
//! dictionary says yes.

// The framework's constants keep their C names, in match patterns as well as
// at their declarations, so this file can be read side by side with the SDK
// headers it was written from.
#![allow(non_upper_case_globals)]

use std::collections::HashMap;
use std::ffi::c_void;
use std::io::{Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::AppHandle;

use crate::cdtext::to_latin1;
use crate::job::{emit_progress, PROGRESS_THROTTLE_MS};
use crate::macos_ffi::*;
use crate::model::{
    BurnMediaInfo, BurnOptions, BurnOutcome, BurnPhase, BurnRecorder, BurnWriteCapabilities,
    CdTextVerification, BYTES_PER_AUDIO_SECTOR, DEFAULT_80_MIN_SECTORS, PREGAP_SECTORS,
    SECTORS_PER_SECOND,
};
use crate::render::RenderedTrack;

/// One CD "1x" in KB/s, where 1 KB = 1000 bytes. 176.4 KB/s is 75 sectors of
/// 2352 bytes, so this is the same speed the rest of the crate counts in
/// sectors per second.
const CD_1X_KPS: f64 = 176.4;

/// How often the burn loop reads `DRBurnCopyStatus`. Matches the event
/// throttle so a tick never has to be dropped.
const POLL_INTERVAL: Duration = Duration::from_millis(PROGRESS_THROTTLE_MS as u64);

/// ISO 639 code for the single CD-TEXT language block we write, matching the
/// shared encoder's `LANGUAGE_ENGLISH`.
const CD_TEXT_LANGUAGE: &str = "en";

/// How long to wait for the drive to wind down after `DRBurnAbort` before
/// reporting the cancellation anyway. Generous: a drive finishing the block it
/// is on can take a few seconds, and giving up early would leave the engine
/// running behind our back.
const ABORT_GRACE: Duration = Duration::from_secs(30);

// ── Unit conversions ─────────────────────────────────────────────────────────

/// The framework talks KB/s; the rest of the burner talks sectors per second.
fn kps_to_sectors_per_second(kps: f64) -> u32 {
    if !kps.is_finite() || kps <= 0.0 {
        return 0;
    }
    (kps / CD_1X_KPS * f64::from(SECTORS_PER_SECOND)).round() as u32
}

fn sectors_per_second_to_kps(sectors: u32) -> f32 {
    (f64::from(sectors) / f64::from(SECTORS_PER_SECOND) * CD_1X_KPS) as f32
}

// ── Device handles ───────────────────────────────────────────────────────────

/// Open the device whose IORegistry path is `recorder_id`.
///
/// The IORegistry path is what `list_recorders` handed the frontend, and it
/// survives the app being restarted while the drive stays plugged in.
fn open_device(recorder_id: &str) -> Result<CfOwned, String> {
    let path = cf_string(recorder_id)
        .ok_or_else(|| "that drive id is not usable".to_string())?;
    // SAFETY: `path` is a valid CFString for the duration of the call, and the
    // returned device carries a +1 reference `CfOwned` takes over.
    let device = unsafe { CfOwned::from_create(DRDeviceCopyDeviceForIORegistryEntryPath(path.get())) }
        .ok_or_else(|| {
            "that drive is no longer available (reconnect it and refresh)".to_string()
        })?;
    // SAFETY: `device` is a valid DRDevice.
    if unsafe { DRDeviceIsValid(device.get()) } == 0 {
        return Err("that drive is no longer available (reconnect it and refresh)".to_string());
    }
    Ok(device)
}

/// Claims the blank disc for the duration of a burn so the Finder does not
/// take it first, and always gives it back.
struct MediaReservation {
    device: CFTypeRef,
}

impl MediaReservation {
    /// # Safety
    /// `device` must be a valid `DRDeviceRef` that outlives the guard.
    unsafe fn acquire(device: CFTypeRef) -> Self {
        unsafe { DRDeviceAcquireMediaReservation(device) };
        Self { device }
    }
}

impl Drop for MediaReservation {
    fn drop(&mut self) {
        // SAFETY: paired with the acquire above, on a device the caller keeps
        // alive for at least as long as this guard.
        unsafe { DRDeviceReleaseMediaReservation(self.device) };
    }
}

// ── Recorder enumeration ─────────────────────────────────────────────────────

/// Read one drive's write-capability dictionary into the shared shape.
///
/// The mapping is not one-to-one with Windows and does not pretend to be:
/// macOS answers "can you carry CD-TEXT" directly, where Windows has to infer
/// it from R-W subchannel support. `rw_subchannel` therefore carries the
/// framework's direct answer, which is what the field is *for* — the UI's
/// explanation ("this drive cannot write the R-W subchannel that CD-TEXT lives
/// in") stays true either way, because that is physically where it lives.
///
/// # Safety
/// `info` must be null or a valid `DRDeviceCopyInfo` dictionary.
unsafe fn read_write_capabilities(info: CFDictionaryRef) -> BurnWriteCapabilities {
    unsafe {
        let caps = dict_get(info, kDRDeviceWriteCapabilitiesKey);
        if caps.is_null() {
            return BurnWriteCapabilities::default();
        }
        BurnWriteCapabilities {
            reported: true,
            session_at_once: dict_bool(caps, kDRDeviceCanWriteCDSAOKey).unwrap_or(false),
            raw_recording: dict_bool(caps, kDRDeviceCanWriteCDRawKey).unwrap_or(false),
            // No macOS equivalent — the framework does not expose raw
            // multisession as a capability, so report it as unknown rather
            // than guessing.
            raw_multisession: false,
            test_write: dict_bool(caps, kDRDeviceCanTestWriteCDKey).unwrap_or(false),
            cd_rewritable: dict_bool(caps, kDRDeviceCanWriteCDRWKey).unwrap_or(false),
            rw_subchannel: dict_bool(caps, kDRDeviceCanWriteCDTextKey).unwrap_or(false),
            buffer_underrun_free: dict_bool(caps, kDRDeviceCanUnderrunProtectCDKey)
                .unwrap_or(false),
            // The framework builds the cue sheet, so its size limit is never
            // ours to worry about.
            max_cue_sheet_bytes: 0,
        }
    }
}

/// Can this drive stamp ISRCs? Attaching `kDRTrackISRCKey` to a drive that
/// cannot fails the entire burn, so this gates it.
///
/// # Safety
/// `info` must be null or a valid `DRDeviceCopyInfo` dictionary.
unsafe fn can_write_isrc(info: CFDictionaryRef) -> bool {
    unsafe {
        let caps = dict_get(info, kDRDeviceWriteCapabilitiesKey);
        dict_bool(caps, kDRDeviceCanWriteISRCKey).unwrap_or(false)
    }
}

pub fn list_recorders() -> Result<Vec<BurnRecorder>, String> {
    // SAFETY: DRCopyDeviceArray returns a +1 CFArray of DRDeviceRefs, or null
    // when the framework cannot enumerate.
    unsafe {
        let Some(devices) = CfOwned::from_create(DRCopyDeviceArray()) else {
            // Not an error: a machine with no optical drive is the normal case
            // now, and the UI shows the empty list with an explanation.
            return Ok(Vec::new());
        };

        let count = CFArrayGetCount(devices.get());
        let mut out = Vec::new();

        for index in 0..count {
            let device = CFArrayGetValueAtIndex(devices.get(), index);
            if device.is_null() {
                continue;
            }
            let Some(info) = CfOwned::from_create(DRDeviceCopyInfo(device)) else {
                continue;
            };
            let info = info.get();

            let Some(id) = dict_string(info, kDRDeviceIORegistryEntryPathKey) else {
                // Without a stable id there is nothing to hand back to the
                // frontend that would still resolve on the next call.
                continue;
            };

            let vendor = dict_string(info, kDRDeviceVendorNameKey).unwrap_or_default();
            let product = dict_string(info, kDRDeviceProductNameKey).unwrap_or_default();
            let name = format!("{} {}", vendor.trim(), product.trim())
                .trim()
                .to_string();

            let capabilities = read_write_capabilities(info);
            let caps_dict = dict_get(info, kDRDeviceWriteCapabilitiesKey);
            let can_write_cd = dict_bool(caps_dict, kDRDeviceCanWriteCDRKey).unwrap_or(false)
                || dict_bool(caps_dict, kDRDeviceCanWriteCDRWKey).unwrap_or(false);

            // Where the media is, when there is any — the macOS answer to the
            // drive letter Windows shows.
            let volume_paths = CfOwned::from_create(DRDeviceCopyStatus(device))
                .and_then(|status| {
                    let media = dict_get(status.get(), kDRDeviceMediaInfoKey);
                    dict_string(media, kDRDeviceMediaBSDNameKey)
                })
                .map(|bsd| vec![format!("/dev/{bsd}")])
                .unwrap_or_default();

            out.push(BurnRecorder {
                id,
                name: if name.is_empty() {
                    "Optical drive".to_string()
                } else {
                    name
                },
                volume_paths,
                can_write_cd,
                supports_cd_text: can_write_cd && capabilities.can_write_cd_text(),
                capabilities,
            });
        }

        Ok(out)
    }
}

// ── Media probe ──────────────────────────────────────────────────────────────

/// A cheap fingerprint of what is in the drive.
///
/// Polled while the burner page is open so an inserted disc is noticed without
/// the user hunting for Refresh. `DRDeviceCopyStatus` is one dictionary read,
/// so unlike the other two backends nothing had to be made cheaper for this.
pub fn media_state(recorder_id: &str) -> Result<String, String> {
    let Ok(device) = open_device(recorder_id) else {
        // The poll runs constantly and must never raise a toast.
        return Ok("unavailable".to_string());
    };

    // SAFETY: `device` is valid; the status dictionary comes back +1.
    unsafe {
        let Some(status) = CfOwned::from_create(DRDeviceCopyStatus(device.get())) else {
            return Ok("unavailable".to_string());
        };
        let status = status.get();
        let state = dict_get(status, kDRDeviceMediaStateKey);
        if !cf_string_eq(state, kDRDeviceMediaStateMediaPresent) {
            return Ok("empty".to_string());
        }
        let media = dict_get(status, kDRDeviceMediaInfoKey);
        let kind = cf_to_string(dict_get(media, kDRDeviceMediaTypeKey))
            .unwrap_or_else(|| "unknown".to_string());
        let blank = dict_bool(media, kDRDeviceMediaIsBlankKey).unwrap_or(false);
        Ok(format!("{kind}:{blank}"))
    }
}

pub fn probe_media(recorder_id: &str) -> Result<BurnMediaInfo, String> {
    let device = open_device(recorder_id)?;

    // SAFETY: `device` is valid; the status dictionary comes back +1.
    unsafe {
        let Some(status) = CfOwned::from_create(DRDeviceCopyStatus(device.get())) else {
            return Err("the drive did not report its state".to_string());
        };
        let status = status.get();

        let state = dict_get(status, kDRDeviceMediaStateKey);
        let present = cf_string_eq(state, kDRDeviceMediaStateMediaPresent);
        if !present {
            return Ok(BurnMediaInfo {
                present: false,
                blank: false,
                erasable: false,
                media_type: String::new(),
                capacity_sectors: 0,
                write_speeds: Vec::new(),
                blocker: Some("No disc in the drive.".to_string()),
            });
        }

        let media = dict_get(status, kDRDeviceMediaInfoKey);
        let media_class = dict_get(media, kDRDeviceMediaClassKey);
        let is_cd = cf_string_eq(media_class, kDRDeviceMediaClassCD);

        let media_type_ref = dict_get(media, kDRDeviceMediaTypeKey);
        let is_cdrom = cf_string_eq(media_type_ref, kDRDeviceMediaTypeCDROM);
        let is_cdr = cf_string_eq(media_type_ref, kDRDeviceMediaTypeCDR);
        let is_cdrw = cf_string_eq(media_type_ref, kDRDeviceMediaTypeCDRW);
        let media_type = if is_cdrom {
            "CD-ROM".to_string()
        } else if is_cdr {
            "CD-R".to_string()
        } else if is_cdrw {
            "CD-RW".to_string()
        } else {
            cf_to_string(media_type_ref).unwrap_or_else(|| "non-CD media".to_string())
        };

        let is_blank = dict_bool(media, kDRDeviceMediaIsBlankKey).unwrap_or(false);
        let erasable = dict_bool(media, kDRDeviceMediaIsErasableKey).unwrap_or(false);

        // Blocks on a CD are sectors, whatever the block size in use. Fall
        // back on the 80-minute assumption only when the drive says nothing.
        let capacity_sectors = dict_i64(media, kDRDeviceMediaBlocksFreeKey)
            .filter(|blocks| *blocks > 0)
            .map(|blocks| blocks.min(u32::MAX as i64) as u32)
            .unwrap_or(DEFAULT_80_MIN_SECTORS);

        let write_speeds = read_burn_speeds(status);

        let blocker = if !is_cd {
            Some(format!(
                "This is {media_type}. Audio CDs need a blank CD-R or CD-RW."
            ))
        } else if is_cdrom {
            Some("This is a pressed CD-ROM and cannot be written to.".to_string())
        } else if !is_blank {
            Some(if erasable {
                "This CD-RW already holds data. Erase it before burning.".to_string()
            } else {
                "This CD-R is not blank. Audio CDs must be written in one go.".to_string()
            })
        } else {
            None
        };

        Ok(BurnMediaInfo {
            present: true,
            blank: is_blank && is_cd && !is_cdrom,
            erasable,
            media_type,
            capacity_sectors,
            write_speeds,
            blocker,
        })
    }
}

/// Write speeds the drive advertises for the loaded disc, in sectors/second.
///
/// # Safety
/// `status` must be null or a valid `DRDeviceCopyStatus` dictionary.
unsafe fn read_burn_speeds(status: CFDictionaryRef) -> Vec<u32> {
    unsafe {
        let speeds = dict_get(status, kDRDeviceBurnSpeedsKey);
        if speeds.is_null() {
            return Vec::new();
        }
        let count = CFArrayGetCount(speeds);
        let mut out = Vec::new();
        for index in 0..count {
            let value = CFArrayGetValueAtIndex(speeds, index);
            if let Some(kps) = cf_to_f64(value) {
                let sectors = kps_to_sectors_per_second(kps);
                if sectors > 0 && !out.contains(&sectors) {
                    out.push(sectors);
                }
            }
        }
        out.sort_unstable();
        out
    }
}

// ── Track data production ────────────────────────────────────────────────────

/// One track's source of bytes for the burn engine.
///
/// The engine asks by absolute byte address, so the file is seeked rather than
/// streamed — a retry or an out-of-order request cannot desync it.
struct Producer {
    path: std::path::PathBuf,
    /// Open only between `PreBurn` and `PostBurn`.
    file: Option<std::fs::File>,
    /// Authoritative length. `render` guarantees the file is exactly this many
    /// whole sectors.
    sectors: u32,
    /// First reason a request could not be served, kept for one diagnostic per
    /// burn rather than one per block.
    failure: Option<String>,
}

impl Producer {
    fn total_bytes(&self) -> u64 {
        u64::from(self.sectors) * BYTES_PER_AUDIO_SECTOR as u64
    }
}

/// `DRTrackCallbackProc` hands back only the track, with no user pointer, so
/// producer state is looked up by the track's address.
type ProducerRegistry = Mutex<HashMap<usize, Producer>>;

fn producers() -> &'static ProducerRegistry {
    static PRODUCERS: OnceLock<ProducerRegistry> = OnceLock::new();
    PRODUCERS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Feeds one track's PCM to the burn engine.
///
/// Runs on the engine's own thread, inside a burn. **Nothing here may panic** —
/// a panic escaping an `extern "C"` boundary aborts the process, and it would
/// do so with a laser mid-write. Every access is fallible by construction: no
/// `unwrap`, no indexing, no slicing beyond a checked length.
///
/// # Safety
/// Called by `DiscRecording` with a track this process created and, for
/// `ProduceData`, a valid `DRTrackProductionInfo`.
unsafe extern "C" fn produce(
    track: DRTrackRef,
    message: DRTrackMessage,
    io_param: *mut c_void,
) -> OSStatus {
    let key = track as usize;

    match message {
        kDRTrackMessageEstimateLength => {
            if io_param.is_null() {
                return kDRFunctionNotSupportedErr;
            }
            let Ok(registry) = producers().lock() else {
                return kDRDataProductionErr;
            };
            let Some(producer) = registry.get(&key) else {
                return kDRDataProductionErr;
            };
            // SAFETY: for this message `ioParam` is a `UInt64*` the engine owns.
            unsafe { io_param.cast::<u64>().write(u64::from(producer.sectors)) };
            0
        }

        kDRTrackMessagePreBurn => {
            let Ok(mut registry) = producers().lock() else {
                return kDRDataProductionErr;
            };
            let Some(producer) = registry.get_mut(&key) else {
                return kDRDataProductionErr;
            };
            match std::fs::File::open(&producer.path) {
                Ok(file) => {
                    producer.file = Some(file);
                    0
                }
                Err(error) => {
                    producer.failure =
                        Some(format!("could not reopen {}: {error}", producer.path.display()));
                    kDRDataProductionErr
                }
            }
        }

        kDRTrackMessageProduceData => {
            if io_param.is_null() {
                return kDRDataProductionErr;
            }
            // SAFETY: for this message `ioParam` is a `DRTrackProductionInfo*`
            // the engine owns and keeps valid for the call.
            let info = unsafe { &mut *io_param.cast::<DRTrackProductionInfo>() };

            let Ok(mut registry) = producers().lock() else {
                return kDRDataProductionErr;
            };
            let Some(producer) = registry.get_mut(&key) else {
                return kDRDataProductionErr;
            };

            // We never ask for subchannel data, so if the engine wants it the
            // block layout is not what this producer writes. Failing is right:
            // filling the subchannel with whatever was in the buffer would put
            // noise in the R-W channel of a disc that cannot be rewritten.
            if info.flags & kDRFlagSubchannelDataRequested != 0 {
                producer.failure = Some(
                    "the drive asked for subchannel data this track cannot produce".to_string(),
                );
                return kDRDataProductionErr;
            }

            let total = producer.total_bytes();
            if info.buffer.is_null() || info.req_count == 0 || info.requested_address >= total {
                info.act_count = 0;
                info.flags |= kDRFlagNoMoreData;
                return 0;
            }

            let want = u64::from(info.req_count).min(total - info.requested_address) as usize;
            // SAFETY: the engine guarantees `buffer` is writable for
            // `req_count` bytes, and `want <= req_count`.
            let out = unsafe { std::slice::from_raw_parts_mut(info.buffer.cast::<u8>(), want) };

            let Some(file) = producer.file.as_mut() else {
                producer.failure = Some("the rendered track was not open".to_string());
                return kDRDataProductionErr;
            };
            if let Err(error) = file.seek(SeekFrom::Start(info.requested_address)) {
                producer.failure = Some(format!("seek failed: {error}"));
                return kDRDataProductionErr;
            }

            let mut filled = 0_usize;
            while filled < want {
                match file.read(&mut out[filled..]) {
                    Ok(0) => break,
                    Ok(n) => filled += n,
                    Err(ref error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                    Err(error) => {
                        producer.failure = Some(format!("read failed: {error}"));
                        return kDRDataProductionErr;
                    }
                }
            }

            // A short read means the file shrank under us. Zero the rest
            // rather than handing the engine whatever the buffer held: silence
            // is a recoverable blemish, uninitialised memory on a disc is not.
            if filled < want {
                if producer.failure.is_none() {
                    producer.failure = Some(format!(
                        "{} is shorter than expected; padded with silence",
                        producer.path.display()
                    ));
                }
                out[filled..].fill(0);
            }

            info.act_count = want as u32;
            if info.requested_address + want as u64 >= total {
                info.flags |= kDRFlagNoMoreData;
            }
            0
        }

        kDRTrackMessagePostBurn => {
            if let Ok(mut registry) = producers().lock() {
                if let Some(producer) = registry.get_mut(&key) {
                    producer.file = None;
                }
            }
            0
        }

        // Pregap production, verification and anything added later: declining
        // makes the engine generate the pregap itself, which is what we want.
        _ => kDRFunctionNotSupportedErr,
    }
}

/// Holds the tracks alive for a burn and unregisters their producers.
///
/// The registry keys off track addresses, so an entry left behind would both
/// leak and risk colliding with a later track allocated at the same address.
struct TrackSet {
    tracks: Vec<CfOwned>,
}

impl TrackSet {
    fn keys(&self) -> Vec<usize> {
        self.tracks.iter().map(|t| t.get() as usize).collect()
    }

    /// Whatever the producers recorded going wrong, in order.
    fn failures(&self) -> Vec<String> {
        let Ok(registry) = producers().lock() else {
            return Vec::new();
        };
        self.keys()
            .iter()
            .filter_map(|key| registry.get(key).and_then(|p| p.failure.clone()))
            .collect()
    }
}

impl Drop for TrackSet {
    fn drop(&mut self) {
        if let Ok(mut registry) = producers().lock() {
            for key in self.keys() {
                registry.remove(&key);
            }
        }
    }
}

/// Build one `DRTrack` per rendered file, registering its producer first so a
/// callback can never arrive before the state it needs exists.
fn build_tracks(
    tracks: &[RenderedTrack],
    gapless: bool,
    allow_isrc: bool,
) -> Result<TrackSet, String> {
    let mut set = TrackSet { tracks: Vec::with_capacity(tracks.len()) };

    for (index, track) in tracks.iter().enumerate() {
        let properties = build_track_properties(track, index, gapless, allow_isrc)?;

        // SAFETY: `properties` is a valid CFDictionary; `produce` matches
        // `DRTrackCallbackProc`. The track comes back +1.
        let created = unsafe { CfOwned::from_create(DRTrackCreate(properties.get(), produce)) }
            .ok_or_else(|| format!("could not create track {}", index + 1))?;

        // Register before the track escapes: `DRTrackCreate` itself does not
        // call back, but nothing after this point may run without the state.
        let key = created.get() as usize;
        match producers().lock() {
            Ok(mut registry) => {
                registry.insert(
                    key,
                    Producer {
                        path: track.path.clone(),
                        file: None,
                        sectors: track.sectors,
                        failure: None,
                    },
                );
            }
            Err(_) => return Err("the burn track registry is unusable".to_string()),
        }
        set.tracks.push(created);
    }

    Ok(set)
}

fn build_track_properties(
    track: &RenderedTrack,
    index: usize,
    gapless: bool,
    allow_isrc: bool,
) -> Result<CfOwned, String> {
    // SAFETY: every value below is a freshly created CoreFoundation object
    // that the dictionary retains; the locals release their own reference on
    // drop.
    unsafe {
        let dict = CfOwned::from_create(CFDictionaryCreateMutable(
            std::ptr::null(),
            0,
            &raw const kCFTypeDictionaryKeyCallBacks,
            &raw const kCFTypeDictionaryValueCallBacks,
        ))
        .ok_or_else(|| "could not describe the track".to_string())?;
        let raw = dict.get().cast_mut();

        let length = cf_number_i64(i64::from(track.sectors))
            .ok_or_else(|| "could not describe the track length".to_string())?;
        CFDictionarySetValue(raw, kDRTrackLengthKey, length.get());

        // Red Book audio geometry. All five must agree or the engine writes a
        // data track's layout with audio bytes in it.
        for (key, value) in [
            (kDRBlockSizeKey, kDRBlockSizeAudio),
            (kDRBlockTypeKey, kDRBlockTypeAudio),
            (kDRDataFormKey, kDRDataFormAudio),
            (kDRTrackModeKey, kDRTrackModeAudio),
            (kDRSessionFormatKey, kDRSessionFormatAudio),
        ] {
            let number = cf_number_i32(value)
                .ok_or_else(|| "could not describe the track format".to_string())?;
            CFDictionarySetValue(raw, key, number.get());
        }

        // Gapless means no gap *between* tracks; track 1's 150-sector pregap is
        // mandatory and is what `plan` already reserves. Without this key the
        // engine gives every track 150 sectors, which is the gapped disc.
        let pregap = if index == 0 {
            PREGAP_SECTORS
        } else if gapless {
            0
        } else {
            PREGAP_SECTORS
        };
        let pregap = cf_number_i32(pregap as i32)
            .ok_or_else(|| "could not describe the pregap".to_string())?;
        CFDictionarySetValue(raw, kDRPreGapLengthKey, pregap.get());

        // We do not read the disc back through the engine, so asking it to
        // verify would only double the time in the drive.
        CFDictionarySetValue(raw, kDRVerificationTypeKey, kDRVerificationTypeNone);
        CFDictionarySetValue(raw, kDRAudioPreEmphasisKey, cf_bool(false));

        // ISRC is exactly 12 bytes here (Windows takes a string), and a drive
        // that cannot write one fails the whole burn — hence `allow_isrc`.
        if allow_isrc {
            if let Some(isrc) = track.isrc.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                let bytes: Vec<u8> = isrc
                    .bytes()
                    .filter(|b| b.is_ascii_alphanumeric())
                    .take(12)
                    .collect();
                if bytes.len() == 12 {
                    if let Some(data) = cf_data(&bytes) {
                        CFDictionarySetValue(raw, kDRTrackISRCKey, data.get());
                    }
                } else {
                    // A malformed code must not cost the user the disc.
                    crate::app_eprintln!(
                        "[burn] ignoring malformed ISRC on track {}: {isrc}",
                        index + 1
                    );
                }
            }
        }

        Ok(dict)
    }
}

// ── CD-TEXT ──────────────────────────────────────────────────────────────────

/// Build the CD-TEXT block, or `None` when there is nothing worth writing.
///
/// Strings go through the shared `to_latin1` first. The framework will encode
/// to Latin-1 itself, but by substitution rather than transliteration —
/// measured against the live framework, `Żubr Kolektyw` comes back as
/// `?ubr Kolektyw`, where the shared encoder gives `Zubr Kolektyw`. Doing it
/// ourselves also keeps macOS and Windows discs byte-identical.
fn build_cd_text(options: &BurnOptions, tracks: &[RenderedTrack]) -> Option<CfOwned> {
    let disc_title = options.disc_title.as_deref().unwrap_or_default().trim();
    let disc_performer = options.disc_performer.as_deref().unwrap_or_default().trim();
    let has_track_text = tracks
        .iter()
        .any(|t| !t.title.trim().is_empty() || !t.artist.trim().is_empty());
    if disc_title.is_empty() && disc_performer.is_empty() && !has_track_text {
        return None;
    }

    let language = cf_string(CD_TEXT_LANGUAGE)?;
    // SAFETY: `language` is a valid CFString; the block comes back +1.
    let block = unsafe {
        CfOwned::from_create(DRCDTextBlockCreate(
            language.get(),
            kDRCDTextEncodingISOLatin1Modified,
        ))
    }?;

    // Index 0 is the disc, 1..n the tracks — the same convention the shared
    // encoder uses, including that the disc slot must exist even when empty or
    // every track's value shifts by one.
    set_cd_text(&block, 0, unsafe { kDRCDTextTitleKey }, disc_title);
    set_cd_text(&block, 0, unsafe { kDRCDTextPerformerKey }, disc_performer);
    for (index, track) in tracks.iter().enumerate() {
        let slot = (index + 1) as CFIndex;
        set_cd_text(&block, slot, unsafe { kDRCDTextTitleKey }, track.title.trim());
        set_cd_text(
            &block,
            slot,
            unsafe { kDRCDTextPerformerKey },
            track.artist.trim(),
        );
    }

    // The framework truncates silently past ~3 KB per block. Say so rather
    // than letting the user find a clipped title on the disc.
    // SAFETY: `block` is a valid CD-Text block.
    let truncated = unsafe { DRCDTextBlockFlatten(block.get()) };
    if truncated > 0 {
        crate::app_eprintln!(
            "[burn] CD-TEXT is {truncated} bytes over what fits; the longest names will be shortened"
        );
    }

    Some(block)
}

fn set_cd_text(block: &CfOwned, track_index: CFIndex, key: CFStringRef, text: &str) {
    if text.is_empty() {
        return;
    }
    let latin1 = to_latin1(text);
    if latin1.is_empty() {
        return;
    }
    let Some(value) = cf_string_latin1(&latin1) else {
        return;
    };
    // SAFETY: block, key and value are all valid; the block retains the value.
    unsafe { DRCDTextBlockSetValue(block.get(), track_index, key, value.get()) };
}

// ── Burn ─────────────────────────────────────────────────────────────────────

pub fn burn(
    app: AppHandle,
    job_id: String,
    tracks: Vec<RenderedTrack>,
    options: BurnOptions,
    cancel: Arc<AtomicBool>,
) -> Result<BurnOutcome, String> {
    if tracks.is_empty() {
        return Err("nothing to burn".to_string());
    }

    let device = open_device(&options.recorder_id)?;
    emit_progress(&app, &job_id, BurnPhase::Preparing, None, 0, 0, None);

    // What the drive says it can do, read once and used to gate the two
    // properties that fail a whole burn when the drive cannot honour them.
    // SAFETY: `device` is valid; the info dictionary comes back +1.
    let info = unsafe { CfOwned::from_create(DRDeviceCopyInfo(device.get())) }
        .ok_or_else(|| "the drive did not report its capabilities".to_string())?;
    // SAFETY: `info` is a valid device-info dictionary.
    let capabilities = unsafe { read_write_capabilities(info.get()) };
    // SAFETY: as above.
    let allow_isrc = unsafe { can_write_isrc(info.get()) };

    let sectors_total: u32 = tracks.iter().fold(0, |acc, t| acc.saturating_add(t.sectors));

    // CD-TEXT is gated on the drive's own answer. Attaching `kDRCDTextKey` to a
    // drive that says no fails the burn with kDRDeviceCantWriteCDTextErr before
    // anything is written — so this check is what turns "your drive can't do
    // CD-TEXT" into a normal disc instead of a refusal.
    let cd_text = if options.cd_text {
        if capabilities.can_write_cd_text() {
            let block = build_cd_text(&options, &tracks);
            if block.is_none() {
                crate::app_eprintln!("[burn] CD-TEXT requested but there is no text to write");
            }
            block
        } else {
            crate::app_eprintln!(
                "[burn] this drive does not report CD-TEXT support; burning without it"
            );
            None
        }
    } else {
        None
    };
    // Attached, not merely asked for: the burn below fails outright if the
    // drive cannot honour the key, so a burn that succeeds with this set did
    // write a lead-in.
    let cd_text_attached = cd_text.is_some();

    if options.test_write && !capabilities.test_write {
        // The framework silently falls back to a real burn when the drive
        // cannot rehearse. That would put a permanent disc in front of a user
        // who explicitly asked for a rehearsal, so refuse instead.
        return Err(
            "This drive cannot do a laser-off test write. Turn test write off to burn for real."
                .to_string(),
        );
    }

    let tracks_built = build_tracks(&tracks, options.gapless, allow_isrc)?;
    let layout = build_layout(&tracks_built)?;

    // SAFETY: `device` is valid; the burn comes back +1.
    let burn = unsafe { CfOwned::from_create(DRBurnCreate(device.get())) }
        .ok_or_else(|| "could not start a burn on this drive".to_string())?;

    let properties = build_burn_properties(&options, &capabilities, cd_text.as_ref())?;
    // SAFETY: burn and properties are both valid; the burn copies what it needs.
    unsafe { DRBurnSetProperties(burn.get(), properties.get()) };

    // Claim the disc so the Finder does not mount or eject it mid-write.
    // SAFETY: `device` outlives the guard.
    let reservation = unsafe { MediaReservation::acquire(device.get()) };

    // The last checkpoint that costs nothing. Past `DRBurnWriteLayout` a
    // cancellation has to go through `DRBurnAbort`, and on a CD-R the disc is
    // spoiled either way.
    if cancel.load(Ordering::Relaxed) {
        return Err("cancelled".to_string());
    }

    let started = Instant::now();
    // SAFETY: burn and layout are valid; the layout is a CFArray of DRTracks,
    // which is the single-session multi-track form the function documents.
    let status = unsafe { DRBurnWriteLayout(burn.get(), layout.get()) };
    if status != 0 {
        return Err(describe_status(status, None));
    }

    let outcome = watch_burn(&app, &job_id, &burn, sectors_total, &cancel);

    // Give the disc back before anything tries to read it.
    drop(reservation);

    // Producer diagnostics, once per burn rather than once per block.
    for failure in tracks_built.failures() {
        crate::app_eprintln!("[burn] track production: {failure}");
    }

    outcome?;

    crate::app_deprintln!(
        "[burn] {} {} sectors in {:?}",
        if options.test_write { "rehearsed" } else { "wrote" },
        sectors_total,
        started.elapsed()
    );

    // Read the disc back rather than trusting the framework's own claim. A
    // failed check is reported as a failed check, never as an empty disc.
    //
    // Not attempted when the disc is on its way out of the drive: the burn's
    // completion action has already ejected it, so a read-back could only ever
    // report "no disc" — which would be read as a CD-TEXT failure on a disc
    // that is perfectly good.
    let can_read_back = cd_text_attached && !options.test_write && !options.eject_when_done;
    let verification = can_read_back
        .then(|| verify_cd_text(&options.recorder_id).unwrap_or_else(CdTextVerification::unreadable));

    Ok(BurnOutcome {
        sectors: sectors_total,
        cd_text_written: cd_text_attached,
        cd_text_verification: verification,
    })
}

/// The single-session, multi-track layout: a `CFArray` of `DRTrack`s.
fn build_layout(tracks: &TrackSet) -> Result<CfOwned, String> {
    // SAFETY: the array retains each track; `tracks` owns them until the burn
    // is over.
    unsafe {
        let array = CfOwned::from_create(CFArrayCreateMutable(
            std::ptr::null(),
            tracks.tracks.len() as CFIndex,
            &raw const kCFTypeArrayCallBacks,
        ))
        .ok_or_else(|| "could not lay the disc out".to_string())?;
        for track in &tracks.tracks {
            CFArrayAppendValue(array.get().cast_mut(), track.get());
        }
        Ok(array)
    }
}

fn build_burn_properties(
    options: &BurnOptions,
    capabilities: &BurnWriteCapabilities,
    cd_text: Option<&CfOwned>,
) -> Result<CfOwned, String> {
    // SAFETY: every value is a valid CoreFoundation object; the dictionary
    // retains what it stores.
    unsafe {
        let dict = CfOwned::from_create(CFDictionaryCreateMutable(
            std::ptr::null(),
            0,
            &raw const kCFTypeDictionaryKeyCallBacks,
            &raw const kCFTypeDictionaryValueCallBacks,
        ))
        .ok_or_else(|| "could not describe the burn".to_string())?;
        let raw = dict.get().cast_mut();

        // Asynchronous, so the loop below can poll status and abort on cancel.
        // A synchronous burn would not return until the disc was finished.
        CFDictionarySetValue(raw, kDRSynchronousBehaviorKey, cf_bool(false));

        // An audio CD must be closed; most players will not read an appendable
        // one.
        CFDictionarySetValue(raw, kDRBurnAppendableKey, cf_bool(false));
        CFDictionarySetValue(raw, kDRBurnVerifyDiscKey, cf_bool(false));
        CFDictionarySetValue(raw, kDRBurnTestingKey, cf_bool(options.test_write));
        CFDictionarySetValue(
            raw,
            kDRBurnUnderrunProtectionKey,
            cf_bool(capabilities.buffer_underrun_free),
        );

        // This key defaults to *eject*, so leaving it out would eject after
        // every burn regardless of what the user chose.
        CFDictionarySetValue(
            raw,
            kDRBurnCompletionActionKey,
            // A rehearsal is ejected whatever the option says: the drive
            // holds the session it opened until the medium is reloaded, and
            // until then it will not call the disc blank again.
            if options.test_write || options.eject_when_done {
                kDRBurnCompletionActionEject
            } else {
                kDRBurnCompletionActionMount
            },
        );
        // Leave a failed disc in the drive: ejecting it hides the drive light
        // and the disc from a user who is about to be told what went wrong.
        CFDictionarySetValue(raw, kDRBurnFailureActionKey, kDRBurnFailureActionNone);

        if let Some(speed) = options.write_speed.filter(|s| *s > 0) {
            if let Some(kps) = cf_number_f32(sectors_per_second_to_kps(speed)) {
                CFDictionarySetValue(raw, kDRBurnRequestedSpeedKey, kps.get());
            }
        }

        // MCN is exactly 13 bytes of CFData here.
        if let Some(mcn) = options
            .media_catalog_number
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let digits: Vec<u8> = mcn.bytes().filter(u8::is_ascii_digit).take(13).collect();
            if digits.len() == 13 {
                if let Some(data) = cf_data(&digits) {
                    CFDictionarySetValue(raw, kDRMediaCatalogNumberKey, data.get());
                }
            } else {
                crate::app_eprintln!("[burn] ignoring malformed media catalog number: {mcn}");
            }
        }

        if let Some(block) = cd_text {
            CFDictionarySetValue(raw, kDRCDTextKey, block.get());
            // Track-At-Once cannot carry CD-TEXT, so ask for Session-At-Once.
            // Only a suggestion — `kDRBurnStrategyIsRequiredKey` is left unset
            // so a drive with another SAO-equivalent strategy still burns.
            if let Some(strategies) = CfOwned::from_create(CFArrayCreateMutable(
                std::ptr::null(),
                1,
                &raw const kCFTypeArrayCallBacks,
            )) {
                CFArrayAppendValue(strategies.get().cast_mut(), kDRBurnStrategyCDSAO);
                CFDictionarySetValue(raw, kDRBurnStrategyKey, strategies.get());
            }
        }

        Ok(dict)
    }
}

// ── Watching a running burn ──────────────────────────────────────────────────

/// Poll `DRBurnCopyStatus` until the burn finishes, bridging it onto
/// `burn:progress`.
///
/// Polling rather than observing is deliberate. `DRNotificationCenter` would
/// need a run loop on this thread and an observer callback; the Windows path's
/// worst bug was a progress sink that silently swallowed every tick while the
/// burn ran fine, and a loop that has to keep running to keep polling cannot
/// fail that way without also failing loudly.
fn watch_burn(
    app: &AppHandle,
    job_id: &str,
    burn: &CfOwned,
    sectors_total: u32,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    let mut aborted_at: Option<Instant> = None;
    let mut last_phase = BurnPhase::Preparing;
    // The ring must never run backwards, even if a status read comes back
    // stale or the engine restarts a track.
    let mut high_water: u32 = 0;

    loop {
        if cancel.load(Ordering::Relaxed) && aborted_at.is_none() {
            // SAFETY: `burn` is a valid, running DRBurn.
            unsafe { DRBurnAbort(burn.get()) };
            aborted_at = Some(Instant::now());
        }

        // An abort the engine never acknowledges would spin here forever, and
        // the job thread above us would never emit `burn:complete` — so the UI
        // would sit on "Stopping…" until the app was killed. Stop waiting and
        // report the cancellation the user already asked for.
        if aborted_at.is_some_and(|at| at.elapsed() > ABORT_GRACE) {
            crate::app_eprintln!("[burn] the drive did not acknowledge the abort; giving up on it");
            return Err("cancelled".to_string());
        }

        // SAFETY: `burn` is valid; the status dictionary comes back +1.
        let Some(status) = (unsafe { CfOwned::from_create(DRBurnCopyStatus(burn.get())) }) else {
            return Err("the drive stopped reporting on the burn".to_string());
        };
        let status = status.get();

        // SAFETY: `status` is a valid status dictionary.
        let state = unsafe { dict_get(status, kDRStatusStateKey) };

        // SAFETY: `state` and the constants are all CFStrings or null.
        let terminal = unsafe {
            if cf_string_eq(state, kDRStatusStateFailed) {
                Some(Err(describe_failure(status)))
            } else if cf_string_eq(state, kDRStatusStateDone) {
                Some(Ok(()))
            } else {
                None
            }
        };

        if let Some(phase) = phase_for(state) {
            last_phase = phase;
        }

        // SAFETY: `status` is valid.
        let percent = unsafe { dict_f64(status, kDRStatusPercentCompleteKey) }.unwrap_or(0.0);
        let done = ((percent.clamp(0.0, 1.0)) * f64::from(sectors_total)).round() as u32;
        high_water = high_water.max(done.min(sectors_total));

        // SAFETY: `status` is valid.
        let track_index = unsafe { dict_i64(status, kDRStatusCurrentTrackKey) }
            .filter(|n| *n >= 1)
            .map(|n| (n - 1) as usize);

        emit_progress(
            app,
            job_id,
            last_phase,
            track_index,
            high_water,
            sectors_total,
            None,
        );

        match terminal {
            Some(Ok(())) => {
                if aborted_at.is_some() || cancel.load(Ordering::Relaxed) {
                    return Err("cancelled".to_string());
                }
                emit_progress(
                    app,
                    job_id,
                    BurnPhase::Closing,
                    None,
                    sectors_total,
                    sectors_total,
                    None,
                );
                return Ok(());
            }
            Some(Err(error)) => {
                // An abort we asked for reports as a failure; that is a
                // cancellation, not something to show the user as a fault.
                if aborted_at.is_some() || cancel.load(Ordering::Relaxed) {
                    return Err("cancelled".to_string());
                }
                return Err(error);
            }
            None => {}
        }

        std::thread::sleep(POLL_INTERVAL);
    }
}

/// Map a `DRStatus` state onto the phase the ring animates.
fn phase_for(state: CFStringRef) -> Option<BurnPhase> {
    // SAFETY: `state` and every constant are CFStrings or null.
    unsafe {
        if cf_string_eq(state, kDRStatusStateTrackWrite) {
            Some(BurnPhase::Writing)
        } else if cf_string_eq(state, kDRStatusStatePreparing)
            || cf_string_eq(state, kDRStatusStateSessionOpen)
            || cf_string_eq(state, kDRStatusStateTrackOpen)
            || cf_string_eq(state, kDRStatusStateNone)
        {
            Some(BurnPhase::Preparing)
        } else if cf_string_eq(state, kDRStatusStateTrackClose)
            || cf_string_eq(state, kDRStatusStateSessionClose)
            || cf_string_eq(state, kDRStatusStateFinishing)
            || cf_string_eq(state, kDRStatusStateVerifying)
        {
            Some(BurnPhase::Closing)
        } else {
            None
        }
    }
}

/// Pull the reason out of a failed burn's status dictionary.
///
/// # Safety
/// `status` must be a valid burn or erase status dictionary.
unsafe fn describe_failure(status: CFDictionaryRef) -> String {
    // SAFETY: `status` is a valid dictionary; every lookup is null-checked.
    unsafe {
        let error = dict_get(status, kDRErrorStatusKey);
        if error.is_null() {
            return "The burn failed, and the drive gave no reason.".to_string();
        }
        let code = dict_i64(error, kDRErrorStatusErrorKey).unwrap_or(0) as OSStatus;
        // The framework's own sentence is usually better than anything we
        // could write for the codes we do not special-case.
        let detail = dict_string(error, kDRErrorStatusErrorStringKey).or_else(|| {
            dict_string(error, kDRErrorStatusErrorInfoStringKey)
        });
        describe_status(code, detail.as_deref())
    }
}

/// Translate the DiscRecording failures a user can act on.
fn describe_status(code: OSStatus, detail: Option<&str>) -> String {
    let known = match code {
        kDRDeviceAccessErr => Some("Psysonic could not get access to the drive.".to_string()),
        kDRDeviceBusyErr | kDRMediaBusyErr => {
            Some("The drive is busy. Close anything else using it and try again.".to_string())
        }
        kDRDeviceCommunicationErr => {
            Some("The drive stopped responding. Reconnect it and try again.".to_string())
        }
        kDRDeviceInvalidErr => {
            Some("That drive is no longer available (reconnect it and refresh).".to_string())
        }
        kDRDeviceNotReadyErr => Some("The drive is not ready yet. Try again in a moment.".to_string()),
        kDRDeviceNotSupportedErr => Some("This drive cannot write discs.".to_string()),
        kDRMediaNotPresentErr => Some("The disc was removed during the burn.".to_string()),
        kDRMediaNotWritableErr => Some("The disc is write-protected.".to_string()),
        kDRMediaNotSupportedErr | kDRMediaInvalidErr => Some(
            "That disc cannot hold an audio CD. Use a blank CD-R or CD-RW.".to_string(),
        ),
        kDRMediaNotBlankErr => {
            Some("This disc is not blank. Audio CDs must be written in one go.".to_string())
        }
        kDRMediaNotErasableErr => Some("This disc cannot be erased.".to_string()),
        kDRBurnUnderrunErr => Some(
            "The drive ran out of data mid-burn (buffer underrun). Try a slower write speed."
                .to_string(),
        ),
        kDRBurnNotAllowedErr => Some("The drive would not allow this burn.".to_string()),
        kDRDataProductionErr => {
            Some("A rendered track could not be read while burning.".to_string())
        }
        kDRUserCanceledErr => Some("cancelled".to_string()),
        kDRBurnPowerCalibrationErr => Some(
            "The drive could not calibrate its laser for this disc. Try a different blank."
                .to_string(),
        ),
        kDRBurnMediaWriteFailureErr => {
            Some("The drive failed to write the disc. Try a different blank.".to_string())
        }
        kDRDeviceBurnStrategyNotAvailableErr => Some(
            "This drive does not support the recording mode an audio CD needs.".to_string(),
        ),
        kDRDeviceCantWriteCDTextErr => Some("This drive cannot write CD-TEXT.".to_string()),
        kDRDeviceCantWriteISRCErr => Some("This drive cannot write ISRC codes.".to_string()),
        _ => None,
    };

    match (known, detail) {
        (Some(message), _) => message,
        (None, Some(detail)) if !detail.trim().is_empty() => detail.to_string(),
        (None, _) => format!("The burn failed (error {code:#010x})."),
    }
}

// ── Erase (CD-RW) ────────────────────────────────────────────────────────────

pub fn erase(recorder_id: &str, quick: bool) -> Result<(), String> {
    let device = open_device(recorder_id)?;

    // SAFETY: `device` is valid; the erase object comes back +1.
    let erase = unsafe { CfOwned::from_create(DREraseCreate(device.get())) }
        .ok_or_else(|| "could not start an erase on this drive".to_string())?;

    // SAFETY: building a property dictionary of valid CF objects.
    unsafe {
        let dict = CfOwned::from_create(CFDictionaryCreateMutable(
            std::ptr::null(),
            0,
            &raw const kCFTypeDictionaryKeyCallBacks,
            &raw const kCFTypeDictionaryValueCallBacks,
        ))
        .ok_or_else(|| "could not describe the erase".to_string())?;
        CFDictionarySetValue(
            dict.get().cast_mut(),
            kDREraseTypeKey,
            if quick {
                kDREraseTypeQuick
            } else {
                kDREraseTypeComplete
            },
        );
        // Synchronous: an erase has no per-track progress to report and the
        // caller already runs on a blocking task.
        CFDictionarySetValue(dict.get().cast_mut(), kDRSynchronousBehaviorKey, cf_bool(true));
        DREraseSetProperties(erase.get(), dict.get());
    }

    // SAFETY: `erase` is valid and configured.
    let status = unsafe { DREraseStart(erase.get()) };
    if status != 0 {
        return Err(describe_status(status, None));
    }

    // A synchronous erase returns having finished, but the outcome lives in
    // the status dictionary rather than the return value.
    // SAFETY: `erase` is valid; the status comes back +1.
    let Some(result) = (unsafe { CfOwned::from_create(DREraseCopyStatus(erase.get())) }) else {
        return Ok(());
    };
    // SAFETY: `result` is a valid status dictionary.
    unsafe {
        let state = dict_get(result.get(), kDRStatusStateKey);
        if cf_string_eq(state, kDRStatusStateFailed) {
            return Err(describe_failure(result.get()));
        }
    }
    Ok(())
}

// ── CD-TEXT read-back ────────────────────────────────────────────────────────

/// Read CD-TEXT back off the disc that is loaded right now.
///
/// The framework has no public read-back call — `_DRDeviceReadCDText` exists
/// but is private SPI — so this asks `drutil`, the first-party tool macOS
/// ships for exactly this, and which is the same engine underneath.
///
/// The parse is deliberately one-sided: it reports `found` only when it
/// positively recognises CD-TEXT content, and `unreadable` for everything
/// else. It will never claim a drive wrote nothing on the strength of output
/// it failed to understand — that mistake is what made the first Windows
/// CD-TEXT failure report the wrong cause.
pub fn verify_cd_text(recorder_id: &str) -> Result<CdTextVerification, String> {
    // A disc has to be there before an empty answer means anything.
    let media = probe_media(recorder_id)?;
    if !media.present {
        return Ok(CdTextVerification::unreadable("no disc in the drive"));
    }

    // `drutil` selects a drive by index, bus, or exact vendor/product string.
    // The name is what the user already sees in the picker.
    let name = list_recorders()?
        .into_iter()
        .find(|r| r.id == recorder_id)
        .map(|r| r.name)
        .unwrap_or_default();

    let mut command = std::process::Command::new("/usr/bin/drutil");
    if !name.is_empty() {
        command.arg("-drive").arg(&name);
    }
    let output = match command.arg("cdtext").output() {
        Ok(output) => output,
        Err(error) => {
            return Ok(CdTextVerification::unreadable(format!(
                "could not run drutil: {error}"
            )))
        }
    };
    if !output.status.success() {
        return Ok(CdTextVerification::unreadable(
            "drutil could not read the disc",
        ));
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let entries = count_cd_text_entries(&text);
    if entries == 0 {
        // Could be a disc with no CD-TEXT, or output we did not understand.
        // We cannot tell the two apart, so we do not guess.
        return Ok(CdTextVerification::unreadable(
            "drutil reported no CD-TEXT; reload the disc and check again",
        ));
    }
    Ok(CdTextVerification::found(entries))
}

/// Count recognisable CD-TEXT fields in `drutil cdtext` output.
///
/// Matches on the field names the CD-TEXT format defines rather than on
/// layout, so a change in spacing or column alignment does not turn a real
/// read into a false negative.
fn count_cd_text_entries(output: &str) -> u32 {
    const FIELDS: [&str; 6] = [
        "title",
        "performer",
        "songwriter",
        "composer",
        "arranger",
        "message",
    ];
    let mut count = 0_u32;
    for line in output.lines() {
        let Some((label, value)) = line.split_once(':') else {
            continue;
        };
        let label = label.trim().to_ascii_lowercase();
        if value.trim().is_empty() {
            continue;
        }
        if FIELDS.iter().any(|field| label.contains(field)) {
            count = count.saturating_add(1);
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::io::Write;

    /// A rendered track of `sectors` sectors, each byte carrying its own
    /// offset so a misaligned read is visible rather than plausible.
    fn pcm_fixture(dir: &std::path::Path, name: &str, sectors: u32) -> RenderedTrack {
        let path = dir.join(name);
        let len = sectors as usize * BYTES_PER_AUDIO_SECTOR;
        let bytes: Vec<u8> = (0..len).map(|i| (i % 251) as u8).collect();
        std::fs::File::create(&path)
            .expect("fixture")
            .write_all(&bytes)
            .expect("fixture");
        RenderedTrack {
            path,
            sectors,
            isrc: None,
            title: "Track Title".to_string(),
            artist: "Track Artist".to_string(),
        }
    }

    fn expected_byte(offset: u64) -> u8 {
        (offset % 251) as u8
    }

    /// Ask the producer for `req` bytes at `address`, as the burn engine would.
    fn request(track: DRTrackRef, address: u64, req: u32, flags: u32) -> (OSStatus, u32, u32, Vec<u8>) {
        let mut buffer = vec![0xCC_u8; req as usize];
        let mut info = DRTrackProductionInfo {
            buffer: buffer.as_mut_ptr().cast(),
            req_count: req,
            act_count: 0,
            flags,
            block_size: kDRBlockSizeAudio as u32,
            requested_address: address,
        };
        // SAFETY: `info` is well-formed and `buffer` outlives the call.
        let status = unsafe {
            produce(
                track,
                kDRTrackMessageProduceData,
                (&raw mut info).cast(),
            )
        };
        (status, info.act_count, info.flags, buffer)
    }

    #[test]
    fn the_framework_asks_our_producer_for_the_track_length() {
        // End to end through the real framework: DRTrackCreate, the registry
        // lookup, and the 'esti' dispatch back into `produce`.
        let dir = tempfile::tempdir().expect("tempdir");
        let track = pcm_fixture(dir.path(), "01.pcm", 900);
        let set = build_tracks(&[track], true, false).expect("tracks");
        let created = set.tracks.first().expect("one track").get();

        // SAFETY: `created` is a live DRTrack this process made.
        let estimated = unsafe { DRTrackEstimateLength(created) };
        assert_eq!(estimated, 900, "the engine must see the rendered length");
    }

    #[test]
    fn produced_bytes_are_the_rendered_pcm_at_the_address_the_engine_asked_for() {
        let dir = tempfile::tempdir().expect("tempdir");
        let track = pcm_fixture(dir.path(), "01.pcm", 8);
        let set = build_tracks(&[track], true, false).expect("tracks");
        let created = set.tracks.first().expect("one track").get();

        // SAFETY: opening the fixture for production.
        assert_eq!(
            unsafe { produce(created, kDRTrackMessagePreBurn, std::ptr::null_mut()) },
            0
        );

        // A mid-track request must come from that offset, not from the start —
        // the bug that would put the whole disc one block out of step.
        let address = 3 * BYTES_PER_AUDIO_SECTOR as u64;
        let (status, act, _, buffer) = request(created, address, 2 * kDRBlockSizeAudio as u32, 0);
        assert_eq!(status, 0);
        assert_eq!(act, 2 * kDRBlockSizeAudio as u32);
        for (index, byte) in buffer.iter().enumerate() {
            assert_eq!(*byte, expected_byte(address + index as u64), "byte {index}");
        }
    }

    #[test]
    fn the_last_request_is_clipped_to_the_track_and_flagged_as_the_end() {
        let dir = tempfile::tempdir().expect("tempdir");
        let track = pcm_fixture(dir.path(), "01.pcm", 4);
        let set = build_tracks(&[track], true, false).expect("tracks");
        let created = set.tracks.first().expect("one track").get();
        // SAFETY: as above.
        unsafe { produce(created, kDRTrackMessagePreBurn, std::ptr::null_mut()) };

        // Ask for four sectors starting at the last one: only one exists.
        let address = 3 * BYTES_PER_AUDIO_SECTOR as u64;
        let (status, act, flags, _) = request(created, address, 4 * kDRBlockSizeAudio as u32, 0);
        assert_eq!(status, 0);
        assert_eq!(act, kDRBlockSizeAudio as u32, "must not read past the track");
        assert!(flags & kDRFlagNoMoreData != 0, "the end must be announced");

        // And past the end there is nothing at all.
        let past = 4 * BYTES_PER_AUDIO_SECTOR as u64;
        let (status, act, flags, _) = request(created, past, kDRBlockSizeAudio as u32, 0);
        assert_eq!(status, 0);
        assert_eq!(act, 0);
        assert!(flags & kDRFlagNoMoreData != 0);
    }

    #[test]
    fn a_request_for_subchannel_data_is_refused_rather_than_filled_with_noise() {
        let dir = tempfile::tempdir().expect("tempdir");
        let track = pcm_fixture(dir.path(), "01.pcm", 4);
        let set = build_tracks(&[track], true, false).expect("tracks");
        let created = set.tracks.first().expect("one track").get();
        // SAFETY: as above.
        unsafe { produce(created, kDRTrackMessagePreBurn, std::ptr::null_mut()) };

        let (status, _, _, _) = request(
            created,
            0,
            kDRBlockSizeAudio as u32,
            kDRFlagSubchannelDataRequested,
        );
        assert_eq!(
            status, kDRDataProductionErr,
            "producing audio into a subchannel layout would write noise to the disc"
        );
    }

    #[test]
    fn an_unknown_message_declines_so_the_engine_handles_it_itself() {
        let dir = tempfile::tempdir().expect("tempdir");
        let track = pcm_fixture(dir.path(), "01.pcm", 4);
        let set = build_tracks(&[track], true, false).expect("tracks");
        let created = set.tracks.first().expect("one track").get();
        // 'prpr' — pregap production, which the engine generates for us.
        // SAFETY: no ioParam is read for a message we decline.
        let status = unsafe { produce(created, 0x7072_7072, std::ptr::null_mut()) };
        assert_eq!(status, kDRFunctionNotSupportedErr);
    }

    #[test]
    fn dropping_the_track_set_leaves_no_producer_behind() {
        let dir = tempfile::tempdir().expect("tempdir");
        let track = pcm_fixture(dir.path(), "01.pcm", 4);
        let keys = {
            let set = build_tracks(&[track], true, false).expect("tracks");
            let keys = set.keys();
            assert!(producers().lock().expect("registry").contains_key(&keys[0]));
            keys
        };
        // Track addresses are reused, so a stale entry would feed the wrong
        // file to a later burn.
        assert!(!producers().lock().expect("registry").contains_key(&keys[0]));
    }

    #[test]
    fn cd_text_is_transliterated_before_the_framework_can_substitute_question_marks() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut track = pcm_fixture(dir.path(), "01.pcm", 4);
        track.title = "Żubr Kolektyw — ぁ".to_string();
        track.artist = "Bjork".to_string();

        let options = BurnOptions {
            recorder_id: String::new(),
            write_speed: None,
            test_write: false,
            gapless: true,
            normalize: false,
            eject_when_done: false,
            media_catalog_number: None,
            cd_text: true,
            disc_title: Some("Sampler".to_string()),
            disc_performer: None,
        };
        let block = build_cd_text(&options, &[track]).expect("a block");

        // SAFETY: `block` is a live CD-Text block; the returned value is
        // borrowed.
        let title = unsafe {
            cf_to_string(DRCDTextBlockGetValue(block.get(), 1, kDRCDTextTitleKey))
        }
        .expect("a title");
        assert!(
            title.starts_with("Zubr Kolektyw"),
            "expected transliteration, got {title:?}"
        );
        assert!(
            !title.starts_with('?'),
            "the framework's own substitution leaked through: {title:?}"
        );

        // SAFETY: as above.
        let disc = unsafe {
            cf_to_string(DRCDTextBlockGetValue(block.get(), 0, kDRCDTextTitleKey))
        };
        assert_eq!(disc.as_deref(), Some("Sampler"), "index 0 is the disc");
    }

    #[test]
    fn a_disc_with_no_text_at_all_produces_no_cd_text_block() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut track = pcm_fixture(dir.path(), "01.pcm", 4);
        track.title = String::new();
        track.artist = String::new();
        let options = BurnOptions {
            recorder_id: String::new(),
            write_speed: None,
            test_write: false,
            gapless: true,
            normalize: false,
            eject_when_done: false,
            media_catalog_number: None,
            cd_text: true,
            disc_title: None,
            disc_performer: None,
        };
        assert!(build_cd_text(&options, &[track]).is_none());
    }

    #[test]
    fn gapless_removes_the_gap_between_tracks_but_never_the_first_pregap() {
        let dir = tempfile::tempdir().expect("tempdir");
        let first = pcm_fixture(dir.path(), "01.pcm", 4);
        let second = pcm_fixture(dir.path(), "02.pcm", 4);

        for (gapless, expected_second) in [(true, 0), (false, PREGAP_SECTORS as i64)] {
            let properties: Vec<_> = [&first, &second]
                .iter()
                .enumerate()
                .map(|(index, track)| {
                    build_track_properties(track, index, gapless, false).expect("properties")
                })
                .collect();
            // SAFETY: each dictionary is live and holds CFNumbers.
            unsafe {
                assert_eq!(
                    dict_i64(properties[0].get(), kDRPreGapLengthKey),
                    Some(PREGAP_SECTORS as i64),
                    "track 1's two-second pregap is mandatory"
                );
                assert_eq!(
                    dict_i64(properties[1].get(), kDRPreGapLengthKey),
                    Some(expected_second)
                );
            }
        }
    }

    #[test]
    fn one_times_speed_round_trips_between_kps_and_sectors() {
        assert_eq!(kps_to_sectors_per_second(CD_1X_KPS), SECTORS_PER_SECOND);
        assert_eq!(sectors_per_second_to_kps(SECTORS_PER_SECOND), 176.4);
    }

    #[test]
    fn faster_speeds_scale_linearly() {
        // 48x is 8467.2 KB/s, which is 3600 sectors per second.
        assert_eq!(kps_to_sectors_per_second(8467.2), 48 * SECTORS_PER_SECOND);
        assert_eq!(kps_to_sectors_per_second(705.6), 4 * SECTORS_PER_SECOND);
    }

    #[test]
    fn nonsense_speeds_are_discarded_rather_than_wrapped() {
        assert_eq!(kps_to_sectors_per_second(0.0), 0);
        assert_eq!(kps_to_sectors_per_second(-1.0), 0);
        assert_eq!(kps_to_sectors_per_second(f64::NAN), 0);
        assert_eq!(kps_to_sectors_per_second(f64::INFINITY), 0);
    }

    #[test]
    fn cd_text_fields_are_counted_however_the_output_is_spaced() {
        let output = "\
            Disc information:\n\
            \tTitle: Some Album\n\
            \tPerformer:   Some Artist\n\
            Track 1:\n\
            \tTitle: First Song\n\
            \tPerformer: Some Artist\n";
        assert_eq!(count_cd_text_entries(output), 4);
    }

    #[test]
    fn empty_values_and_unrelated_lines_are_not_counted() {
        let output = "\
            Vendor: HL-DT-ST\n\
            Title:\n\
            Performer: \n\
            no colon here\n";
        assert_eq!(count_cd_text_entries(output), 0);
    }

    #[test]
    fn nothing_recognised_never_reads_as_a_verified_empty_disc() {
        // The distinction that matters: unparsed output must not be reported
        // as "the drive wrote nothing".
        assert_eq!(count_cd_text_entries("drutil: no media\n"), 0);
        let verification = CdTextVerification::unreadable("drutil reported no CD-TEXT");
        assert!(!verification.checked);
        assert!(verification.error.is_some());
    }
}
