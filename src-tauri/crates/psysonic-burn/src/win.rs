//! Windows burn backend — IMAPI2.
//!
//! Audio CDs via `IRawCDImageCreator` + `IDiscFormat2RawCD`: Disc-At-Once,
//! gapless, ISRC and MCN. This is the default path and the fallback.
//!
//! IMAPI2 has no CD-TEXT support, so when CD-TEXT is asked for and the drive
//! reports it can, `win_sao` takes over the write instead. A drive that refuses
//! that setup falls back here and burns without CD-TEXT, which is why this path
//! stays the one that must always work. See `src/features/burner/README.md`.
//!
//! IMAPI2 runs unelevated (it is what Explorer's own burn UI uses), which is
//! why this is the right backend for a `currentUser` install.
//!
//! Every entry point hops onto a dedicated COM thread. Tauri commands run on
//! tokio workers whose apartment state we do not own, and IMAPI2 is picky
//! about being driven from a thread that initialised COM itself.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::AppHandle;
use windows::Win32::Foundation::{VARIANT_BOOL, VARIANT_FALSE, VARIANT_TRUE};
use windows::Win32::Storage::Imapi::{
    IDiscFormat2Erase, IDiscFormat2RawCD, IDiscFormat2RawCDEventArgs, IDiscMaster2, IDiscRecorder2,
    IDiscRecorder2Ex, IRawCDImageCreator, DDiscFormat2RawCDEvents, DDiscFormat2RawCDEvents_Impl,
    IMAPI_CD_SECTOR_AUDIO, IMAPI_FEATURE_PAGE_TYPE_CD_MASTERING,
    IMAPI_FORMAT2_RAW_CD_DATA_SECTOR_TYPE,
    IMAPI_FORMAT2_RAW_CD_SUBCODE_IS_COOKED, IMAPI_FORMAT2_RAW_CD_SUBCODE_IS_RAW,
    IMAPI_FORMAT2_RAW_CD_SUBCODE_PQ_ONLY,
    IMAPI_FORMAT2_RAW_CD_WRITE_ACTION_FINISHING, IMAPI_FORMAT2_RAW_CD_WRITE_ACTION_PREPARING,
    IMAPI_MEDIA_PHYSICAL_TYPE, IMAPI_MEDIA_TYPE_CDR,
    IMAPI_MEDIA_TYPE_CDROM, IMAPI_MEDIA_TYPE_CDRW, MsftDiscFormat2Erase, MsftDiscFormat2RawCD,
    MsftDiscMaster2, MsftDiscRecorder2, MsftRawCDImageCreator,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoTaskMemFree, CoInitializeEx, CoUninitialize, IConnectionPoint, IConnectionPointContainer,
    IDispatch, IDispatch_Impl, IStream, ITypeInfo, CLSCTX_ALL, COINIT_MULTITHREADED,
    DISPATCH_FLAGS, DISPPARAMS, EXCEPINFO, SAFEARRAY, STGM_READ,
};
use windows::Win32::System::Ole::{SafeArrayDestroy, SafeArrayGetElement, SafeArrayGetLBound,
    SafeArrayGetUBound};
use windows::Win32::System::Variant::{
    VariantChangeType, VariantClear, VARIANT, VT_BSTR, VT_DISPATCH, VT_I4,
};
use windows::Win32::UI::Shell::SHCreateStreamOnFileEx;
use windows_core::{Interface, Ref, BSTR, GUID, HSTRING, PCWSTR};

use crate::job::{emit_progress, PROGRESS_THROTTLE_MS};
use crate::mmc::read_disc_information_cdb;
use crate::cdtext::{CdTextBlock, CdTextInput, CdTextTrack};
use crate::model::{
    BurnMediaInfo, BurnOptions, BurnOutcome, BurnPhase, BurnRecorder, BurnWriteCapabilities,
    DEFAULT_80_MIN_SECTORS,
};
use crate::win_sao::{self, SaoError};
use crate::render::RenderedTrack;

/// Name IMAPI2 shows to other apps that ask who owns the drive. It also shows
/// up in the exclusive-access error when something else holds the recorder,
/// so make it recognisable.
const CLIENT_NAME: &str = "Psysonic";

// ── COM plumbing ─────────────────────────────────────────────────────────────

/// Run `f` on a fresh thread that owns its own COM apartment.
///
/// Multi-threaded apartment: IMAPI2 fires its write events synchronously on
/// the calling thread during `WriteMedia`, so no message pump is needed and we
/// avoid the STA pump requirement entirely.
fn with_com<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    std::thread::Builder::new()
        .name("psysonic-burn-com".into())
        .spawn(move || {
            // SAFETY: fresh thread, so no apartment has been chosen yet.
            let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            if hr.is_err() {
                return Err(format!("could not initialise COM on the burn thread: {hr:?}"));
            }
            let out = f();
            // SAFETY: paired with the CoInitializeEx above on this same thread.
            unsafe { CoUninitialize() };
            out
        })
        .map_err(|e| format!("could not start the burn thread: {e}"))?
        .join()
        .map_err(|_| "the burn thread stopped unexpectedly".to_string())?
}

/// Read a `SAFEARRAY` of `VARIANT` into i32s, skipping anything that will not
/// coerce. Takes ownership: the array is destroyed before returning.
///
/// # Safety
/// `psa` must be a valid SAFEARRAY of VARIANT handed back by IMAPI2.
unsafe fn safearray_i32s(psa: *mut SAFEARRAY) -> Vec<i32> {
    let mut out = Vec::new();
    if psa.is_null() {
        return out;
    }
    unsafe {
        let (Ok(lower), Ok(upper)) = (SafeArrayGetLBound(psa, 1), SafeArrayGetUBound(psa, 1)) else {
            let _ = SafeArrayDestroy(psa);
            return out;
        };
        for index in lower..=upper {
            let mut raw = VARIANT::default();
            if SafeArrayGetElement(psa, &index, (&raw mut raw).cast()).is_err() {
                continue;
            }
            let mut coerced = VARIANT::default();
            if VariantChangeType(&mut coerced, &raw, Default::default(), VT_I4).is_ok() {
                out.push(coerced.Anonymous.Anonymous.Anonymous.lVal);
            }
            let _ = VariantClear(&mut coerced);
            let _ = VariantClear(&mut raw);
        }
        let _ = SafeArrayDestroy(psa);
    }
    out
}

/// Same, for `SAFEARRAY` of `VARIANT` holding BSTRs.
///
/// # Safety
/// `psa` must be a valid SAFEARRAY of VARIANT handed back by IMAPI2.
unsafe fn safearray_strings(psa: *mut SAFEARRAY) -> Vec<String> {
    let mut out = Vec::new();
    if psa.is_null() {
        return out;
    }
    unsafe {
        let (Ok(lower), Ok(upper)) = (SafeArrayGetLBound(psa, 1), SafeArrayGetUBound(psa, 1)) else {
            let _ = SafeArrayDestroy(psa);
            return out;
        };
        for index in lower..=upper {
            let mut raw = VARIANT::default();
            if SafeArrayGetElement(psa, &index, (&raw mut raw).cast()).is_err() {
                continue;
            }
            let mut coerced = VARIANT::default();
            if VariantChangeType(&mut coerced, &raw, Default::default(), VT_BSTR).is_ok() {
                let bstr = &*coerced.Anonymous.Anonymous.Anonymous.bstrVal;
                out.push(bstr.to_string());
            }
            let _ = VariantClear(&mut coerced);
            let _ = VariantClear(&mut raw);
        }
        let _ = SafeArrayDestroy(psa);
    }
    out
}

fn vbool(value: bool) -> VARIANT_BOOL {
    if value {
        VARIANT_TRUE
    } else {
        VARIANT_FALSE
    }
}

fn is_true(value: VARIANT_BOOL) -> bool {
    value != VARIANT_FALSE
}

/// MMC profile numbers for the CD family. A drive that lists none of these
/// cannot write an audio CD no matter what else it supports.
const PROFILE_CD_R: i32 = 0x09;
const PROFILE_CD_RW: i32 = 0x0A;

fn media_type_label(kind: IMAPI_MEDIA_PHYSICAL_TYPE) -> &'static str {
    match kind {
        IMAPI_MEDIA_TYPE_CDROM => "CD-ROM",
        IMAPI_MEDIA_TYPE_CDR => "CD-R",
        IMAPI_MEDIA_TYPE_CDRW => "CD-RW",
        _ => "non-CD media",
    }
}

/// Bind an initialised `IDiscRecorder2` to an IMAPI2 recorder id.
///
/// # Safety
/// Must run on a thread that has initialised COM.
unsafe fn open_recorder(recorder_id: &str) -> Result<IDiscRecorder2, String> {
    unsafe {
        let recorder: IDiscRecorder2 = CoCreateInstance(&MsftDiscRecorder2, None, CLSCTX_ALL)
            .map_err(|e| format!("could not create the disc recorder: {e}"))?;
        recorder
            .InitializeDiscRecorder(&BSTR::from(recorder_id))
            .map_err(|e| {
                format!("that drive is no longer available (reconnect it and refresh): {e}")
            })?;
        Ok(recorder)
    }
}

/// Read MMC feature 002Eh ("CD Mastering") and decode what the drive can do.
///
/// Non-destructive: `GetFeaturePage` is a pure query, so this is safe to run on
/// an empty tray. `current_only = false` asks what the drive supports *at all*
/// rather than what is currently available, which is what we want for deciding
/// whether to offer CD-TEXT before a disc is even loaded.
///
/// Layout (Windows DDK `FEATURE_DATA_CD_MASTERING`, MMC-4 feature 002Eh):
/// bytes 0-1 feature code, byte 2 version/persistent/current, byte 3 additional
/// length, byte 4 flags, bytes 5-7 maximum cue sheet length (big-endian).
///
/// # Safety
/// Must run on a thread that has initialised COM.
unsafe fn read_write_capabilities(recorder: &IDiscRecorder2) -> BurnWriteCapabilities {
    let mut caps = BurnWriteCapabilities::default();

    // SAFETY: the recorder is initialised; the Ex interface is the same object.
    let Ok(ex) = recorder.cast::<IDiscRecorder2Ex>() else {
        return caps;
    };

    let mut data: *mut u8 = std::ptr::null_mut();
    let mut size: u32 = 0;
    // SAFETY: IMAPI2 allocates the buffer with CoTaskMemAlloc and hands us its
    // length; we free it below on every path.
    let read = unsafe {
        ex.GetFeaturePage(
            IMAPI_FEATURE_PAGE_TYPE_CD_MASTERING,
            false,
            &raw mut data,
            &raw mut size,
        )
    };

    if read.is_ok() && !data.is_null() && size >= 8 {
        // SAFETY: IMAPI2 reported `size` valid bytes at `data`.
        let bytes = unsafe { std::slice::from_raw_parts(data, size as usize) };
        let flags = bytes[4];
        caps = BurnWriteCapabilities {
            reported: true,
            // Bit order from the DDK bitfield, which MSVC packs LSB-first.
            rw_subchannel: flags & 0x01 != 0,
            cd_rewritable: flags & 0x02 != 0,
            test_write: flags & 0x04 != 0,
            raw_recording: flags & 0x08 != 0,
            raw_multisession: flags & 0x10 != 0,
            session_at_once: flags & 0x20 != 0,
            buffer_underrun_free: flags & 0x40 != 0,
            max_cue_sheet_bytes: (u32::from(bytes[5]) << 16)
                | (u32::from(bytes[6]) << 8)
                | u32::from(bytes[7]),
        };
    }

    if !data.is_null() {
        // SAFETY: IMAPI2 allocated this with the COM task allocator.
        unsafe { CoTaskMemFree(Some(data.cast())) };
    }
    caps
}

// ── Recorder enumeration ─────────────────────────────────────────────────────

pub fn list_recorders() -> Result<Vec<BurnRecorder>, String> {
    with_com(|| unsafe {
        let master: IDiscMaster2 = CoCreateInstance(&MsftDiscMaster2, None, CLSCTX_ALL)
            .map_err(|e| format!("could not reach the Windows burning service: {e}"))?;

        if !is_true(master.IsSupportedEnvironment().unwrap_or(VARIANT_FALSE)) {
            return Err("this Windows install cannot burn discs".to_string());
        }

        let count = master.Count().unwrap_or(0);
        let mut out = Vec::new();

        for index in 0..count {
            let Ok(id) = master.get_Item(index) else {
                continue;
            };
            let id_string = id.to_string();
            let Ok(recorder) = open_recorder(&id_string) else {
                continue;
            };

            let vendor = recorder.VendorId().map(|v| v.to_string()).unwrap_or_default();
            let product = recorder
                .ProductId()
                .map(|v| v.to_string())
                .unwrap_or_default();
            let name = format!("{} {}", vendor.trim(), product.trim())
                .trim()
                .to_string();

            let volume_paths = recorder
                .VolumePathNames()
                .map(|psa| safearray_strings(psa))
                .unwrap_or_default();

            let profiles = recorder
                .SupportedProfiles()
                .map(|psa| safearray_i32s(psa))
                .unwrap_or_default();
            let can_write_cd = profiles
                .iter()
                .any(|p| *p == PROFILE_CD_R || *p == PROFILE_CD_RW);

            let capabilities = read_write_capabilities(&recorder);

            out.push(BurnRecorder {
                id: id_string,
                name: if name.is_empty() {
                    "Optical drive".to_string()
                } else {
                    name
                },
                volume_paths,
                can_write_cd,
                // The drive's own answer, not an assumption.
                supports_cd_text: can_write_cd && capabilities.can_write_cd_text(),
                capabilities,
            });
        }

        Ok(out)
    })
}

// ── Media probe ──────────────────────────────────────────────────────────────

/// What `READ DISC INFORMATION` says about the disc, byte 2 bits 1..0.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DiscStatus {
    Empty,
    Incomplete,
    Complete,
    Other,
}

/// Ask the drive directly whether the disc is empty.
///
/// `IDiscFormat2RawCD::MediaHeuristicallyBlank` is, as its name says, a guess —
/// and it guesses wrong after a rehearsal. A test write leaves drive-side state
/// behind (an opened session on the SAO path, power calibration on the IMAPI2
/// one) without committing a single sector to the program area, and the
/// heuristic then reports a perfectly burnable CD-R as used. With no erase
/// available for a CD-R, that verdict is unrecoverable in the UI.
///
/// `READ DISC INFORMATION` is the drive's own answer rather than a guess about
/// it. `None` means the drive would not say, and the caller keeps the
/// heuristic.
fn read_disc_status(recorder: &IDiscRecorder2) -> Option<DiscStatus> {
    let ex = recorder.cast::<IDiscRecorder2Ex>().ok()?;

    // SendCommand* needs the drive held. A probe runs while the user is just
    // looking at the page, so a drive busy elsewhere is an ordinary outcome:
    // give up and let the heuristic answer rather than failing the probe.
    let _lock = unsafe { ExclusiveAccess::acquire(recorder) }.ok()?;

    let mut buffer = [0_u8; 34];
    let cdb = read_disc_information_cdb(buffer.len() as u16);
    let mut sense = [0_u8; 18];
    let mut fetched: u32 = 0;

    // SAFETY: a read of at most `buffer.len()` bytes into our own buffer.
    unsafe {
        ex.SendCommandGetDataFromDevice(
            &cdb,
            &mut sense,
            DISC_INFO_TIMEOUT,
            &mut buffer,
            &raw mut fetched,
        )
    }
    .ok()?;

    if (fetched as usize) < 3 {
        return None;
    }
    Some(match buffer[2] & 0x03 {
        0 => DiscStatus::Empty,
        1 => DiscStatus::Incomplete,
        2 => DiscStatus::Complete,
        _ => DiscStatus::Other,
    })
}

/// Seconds allowed for the disc-information query during a probe.
const DISC_INFO_TIMEOUT: u32 = 10;

/// A cheap fingerprint of what is in the drive.
///
/// Polled while the burner page is open so an inserted disc is noticed without
/// the user hunting for Refresh. IMAPI2 answers both questions without a raw
/// command, which matters here: `SendCommand*` needs exclusive access, and
/// taking that every few seconds would fight every other program on the drive.
pub fn media_state(recorder_id: &str) -> Result<String, String> {
    let recorder_id = recorder_id.to_string();
    with_com(move || unsafe {
        let Ok(recorder) = open_recorder(&recorder_id) else {
            // The poll runs constantly and must never raise a toast.
            return Ok("unavailable".to_string());
        };
        let Ok(format) = CoCreateInstance::<_, IDiscFormat2RawCD>(&MsftDiscFormat2RawCD, None, CLSCTX_ALL)
        else {
            return Ok("unavailable".to_string());
        };
        if format.SetRecorder(&recorder).is_err() {
            return Ok("empty".to_string());
        }
        let media = format
            .CurrentPhysicalMediaType()
            .unwrap_or(IMAPI_MEDIA_PHYSICAL_TYPE(0));
        let blank = is_true(format.MediaHeuristicallyBlank().unwrap_or(VARIANT_FALSE));
        Ok(format!("{}:{}", media.0, blank))
    })
}

pub fn probe_media(recorder_id: &str) -> Result<BurnMediaInfo, String> {
    let recorder_id = recorder_id.to_string();
    with_com(move || unsafe {
        let recorder = open_recorder(&recorder_id)?;

        let format: IDiscFormat2RawCD = CoCreateInstance(&MsftDiscFormat2RawCD, None, CLSCTX_ALL)
            .map_err(|e| format!("could not create the CD writer: {e}"))?;

        // SetRecorder fails outright when the tray is empty, which is the
        // normal "no disc" case rather than an error worth surfacing raw.
        if format.SetRecorder(&recorder).is_err() {
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
        let _ = format.SetClientName(&BSTR::from(CLIENT_NAME));

        let media = format
            .CurrentPhysicalMediaType()
            .unwrap_or(IMAPI_MEDIA_PHYSICAL_TYPE(0));
        let media_type = media_type_label(media).to_string();
        let is_cd = matches!(
            media,
            IMAPI_MEDIA_TYPE_CDR | IMAPI_MEDIA_TYPE_CDRW | IMAPI_MEDIA_TYPE_CDROM
        );
        let erasable = media == IMAPI_MEDIA_TYPE_CDRW;

        // The heuristic is the fallback, not the authority: after a test write
        // it reports an untouched CD-R as used, and a CD-R cannot be erased
        // back out of that verdict.
        let heuristic_blank = is_true(format.MediaHeuristicallyBlank().unwrap_or(VARIANT_FALSE));
        let status = read_disc_status(&recorder);
        let blank = match status {
            Some(status) => status == DiscStatus::Empty,
            None => heuristic_blank,
        };
        if let Some(status) = status {
            if (status == DiscStatus::Empty) != heuristic_blank {
                crate::app_eprintln!(
                    "[burn] the drive reports the disc {status:?}; IMAPI2 guessed                      blank={heuristic_blank}. Trusting the drive."
                );
            }
        }
        let supported = is_true(
            format
                .IsCurrentMediaSupported(&recorder)
                .unwrap_or(VARIANT_FALSE),
        );

        // Real lead-out from the disc beats our 80-minute assumption.
        let capacity_sectors = format
            .LastPossibleStartOfLeadout()
            .ok()
            .filter(|v| *v > 0)
            .map(|v| v as u32)
            .unwrap_or(DEFAULT_80_MIN_SECTORS);

        let write_speeds: Vec<u32> = format
            .SupportedWriteSpeeds()
            .map(|psa| safearray_i32s(psa))
            .unwrap_or_default()
            .into_iter()
            .filter(|v| *v > 0)
            .map(|v| v as u32)
            .collect();

        let blocker = if !is_cd {
            Some(format!(
                "This is {media_type}. Audio CDs need a blank CD-R or CD-RW."
            ))
        } else if media == IMAPI_MEDIA_TYPE_CDROM {
            Some("This is a pressed CD-ROM and cannot be written to.".to_string())
        } else if !blank {
            Some(if erasable {
                "This CD-RW already holds data. Erase it before burning.".to_string()
            } else {
                "This CD-R is not blank. Audio CDs must be written in one go.".to_string()
            })
        } else if !supported {
            Some("The drive will not accept this disc.".to_string())
        } else {
            None
        };

        Ok(BurnMediaInfo {
            present: true,
            blank: blank && supported && is_cd && media != IMAPI_MEDIA_TYPE_CDROM,
            erasable,
            media_type,
            capacity_sectors,
            write_speeds,
            blocker,
        })
    })
}

// ── Write-progress event sink ────────────────────────────────────────────────

/// COM sink for `DDiscFormat2RawCDEvents`.
///
/// IMAPI2 calls back on the same thread that is inside `WriteMedia`, once per
/// progress tick. **Nothing in here may panic** — unwinding across the COM
/// boundary is undefined behaviour — so every access is fallible-by-design:
/// no `unwrap`, no indexing, no slicing.
///
/// Only `DDiscFormat2RawCDEvents` is implemented, deliberately. It already
/// derives from `IDispatch` (its vtable's `base__` is `IDispatch_Vtbl`), and
/// listing `IDispatch` separately makes `windows-implement` emit a *second*
/// standalone vtable — so `QueryInterface(IID_IDispatch)` hands back an object
/// whose `Invoke` is not the one wired to the events. That is what silently
/// swallowed every progress callback on the first real burn.
#[windows_core::implement(DDiscFormat2RawCDEvents)]
struct WriteSink {
    app: AppHandle,
    job_id: String,
    sectors_total: u32,
    /// Set when the user asked to stop; the sink calls `CancelWrite`.
    cancel: Arc<AtomicBool>,
    /// Epoch-ms of the last emitted tick, for throttling.
    last_emit_ms: AtomicU64,
    /// Highest LBA the drive has confirmed, so the ring never runs backwards.
    high_water: AtomicI32,
    /// One diagnostic per burn, not one per tick.
    warned: AtomicBool,
    /// The write we may need to cancel. Unadvised (and so dropped) by
    /// `SinkGuard` as soon as `WriteMedia` returns.
    format: IDiscFormat2RawCD,
}

fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl WriteSink {
    /// Report the first reason progress went quiet, once.
    ///
    /// Every path in this sink degrades silently on purpose — a drive that
    /// will not report progress must still burn — but the first cut shipped
    /// with no diagnostics at all, so a dead progress bar on real hardware
    /// said nothing about which path had failed. It says so now.
    fn note_once(&self, reason: &str) {
        if !self.warned.swap(true, Ordering::Relaxed) {
            crate::app_eprintln!("[burn] progress reporting inactive: {reason}");
        }
    }

    /// Body of the callback, written so no path can panic.
    fn on_update(&self, progress: Option<&IDispatch>) {
        // Honour a cancel request first — the sooner the laser stops, the
        // better, even though the disc is already spoiled.
        if self.cancel.load(Ordering::Relaxed) {
            // SAFETY: `format` is a live IMAPI2 object for the write in flight.
            unsafe {
                let _ = self.format.CancelWrite();
            }
            return;
        }

        let Some(dispatch) = progress else {
            self.note_once("event carried no progress object");
            return;
        };
        let Ok(args) = dispatch.cast::<IDiscFormat2RawCDEventArgs>() else {
            self.note_once("progress object was not IDiscFormat2RawCDEventArgs");
            return;
        };

        // SAFETY: `args` is the event-args object IMAPI2 just handed us; every
        // call below is a simple property read on it.
        let (action, last_written, free_buffer, total_buffer) = unsafe {
            (
                args.CurrentAction().ok(),
                args.LastWrittenLba().ok(),
                args.FreeSystemBuffer().ok(),
                args.TotalSystemBuffer().ok(),
            )
        };

        // `CurrentAction` maps to a phase; it is NOT a gate. Gating on
        // `== WRITING` meant one failed property read — or a drive that never
        // reports that action — blacked out the entire progress display.
        let phase = match action {
            Some(IMAPI_FORMAT2_RAW_CD_WRITE_ACTION_PREPARING) => BurnPhase::Preparing,
            Some(IMAPI_FORMAT2_RAW_CD_WRITE_ACTION_FINISHING) => BurnPhase::Closing,
            _ => BurnPhase::Writing,
        };

        let now = epoch_ms();
        let last = self.last_emit_ms.load(Ordering::Relaxed);
        if u128::from(now.saturating_sub(last)) < PROGRESS_THROTTLE_MS {
            return;
        }
        self.last_emit_ms.store(now, Ordering::Relaxed);

        // A monotonic high-water mark: outside the writing action the LBA is
        // not meaningful, and the ring must never run backwards.
        let previous = self.high_water.load(Ordering::Relaxed);
        let lba = last_written.unwrap_or(0).max(0).max(previous);
        self.high_water.store(lba, Ordering::Relaxed);

        let buffer_percent = match (free_buffer, total_buffer) {
            (Some(free), Some(total)) if total > 0 => {
                let used = (total - free).clamp(0, total);
                Some(((used as i64 * 100) / total as i64).clamp(0, 100) as u8)
            }
            _ => None,
        };

        emit_progress(
            &self.app,
            &self.job_id,
            phase,
            None,
            (lba as u32).min(self.sectors_total),
            self.sectors_total,
            buffer_percent,
        );
    }
}

impl DDiscFormat2RawCDEvents_Impl for WriteSink_Impl {
    fn Update(&self, _object: Ref<IDispatch>, progress: Ref<IDispatch>) -> windows_core::Result<()> {
        self.on_update(progress.as_ref());
        Ok(())
    }
}

/// IMAPI2 may drive this sink through the vtable *or* through late binding,
/// depending on how its connection point resolved us. `Invoke` therefore
/// forwards to the same handler rather than being a stub — a stub is what made
/// the first burn report 0% from start to finish.
impl IDispatch_Impl for WriteSink_Impl {
    fn GetTypeInfoCount(&self) -> windows_core::Result<u32> {
        Ok(0)
    }

    fn GetTypeInfo(&self, _itinfo: u32, _lcid: u32) -> windows_core::Result<ITypeInfo> {
        Err(windows_core::Error::empty())
    }

    fn GetIDsOfNames(
        &self,
        _riid: *const GUID,
        _rgsznames: *const PCWSTR,
        _cnames: u32,
        _lcid: u32,
        _rgdispid: *mut i32,
    ) -> windows_core::Result<()> {
        Err(windows_core::Error::empty())
    }

    fn Invoke(
        &self,
        _dispidmember: i32,
        _riid: *const GUID,
        _lcid: u32,
        _wflags: DISPATCH_FLAGS,
        pdispparams: *const DISPPARAMS,
        _pvarresult: *mut VARIANT,
        _pexcepinfo: *mut EXCEPINFO,
        _puargerr: *mut u32,
    ) -> windows_core::Result<()> {
        // The dispinterface declares exactly one method, `Update(object,
        // progress)`, so the DISPID is not worth matching on — the argument
        // shape is the reliable discriminator.
        //
        // SAFETY: the caller owns these arguments for the duration of the call;
        // we only read them, and `pdispVal` is borrowed (ManuallyDrop), never
        // dropped, so the caller's reference count is untouched.
        let progress = unsafe {
            if pdispparams.is_null() {
                None
            } else {
                let params = &*pdispparams;
                // DISPPARAMS args are in reverse declaration order, so the last
                // declared parameter — `progress` — is index 0.
                if params.cArgs == 0 || params.rgvarg.is_null() {
                    None
                } else {
                    let arg = &*params.rgvarg;
                    if arg.Anonymous.Anonymous.vt == VT_DISPATCH {
                        arg.Anonymous.Anonymous.Anonymous.pdispVal.as_ref()
                    } else {
                        None
                    }
                }
            }
        };

        if progress.is_none() {
            self.note_once("late-bound event carried no dispatch argument");
        }
        self.on_update(progress);
        Ok(())
    }
}

/// Keeps an `Advise` cookie alive and always unadvises, including on the error
/// paths out of `WriteMedia`. That also breaks the sink ↔ format reference
/// cycle, so both objects are actually released.
struct SinkGuard {
    point: IConnectionPoint,
    cookie: u32,
}

impl Drop for SinkGuard {
    fn drop(&mut self) {
        // SAFETY: cookie came from this same connection point's Advise.
        unsafe {
            let _ = self.point.Unadvise(self.cookie);
        }
    }
}

// ── Burn ─────────────────────────────────────────────────────────────────────

/// Write `tracks` to the disc in `options.recorder_id`.
///
/// Returns the number of sectors committed. Blocks for the whole burn, so
/// callers run it off the UI path.
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

    with_com(move || unsafe {
        let recorder = open_recorder(&options.recorder_id)?;

        emit_progress(&app, &job_id, BurnPhase::Preparing, None, 0, 0, None);

        // ── CD-TEXT: our own Session-At-Once write ───────────────────────
        //
        // IMAPI2 cannot carry a CD-TEXT lead-in, so when the user asked for it
        // and the drive says it can, we drive the recorder ourselves. The
        // fallback below is the point: a drive that refuses the *setup* has not
        // touched the disc, so the proven IMAPI2 path still gets to burn it.
        // A failure once writing has begun is not recoverable and propagates.
        if options.cd_text {
            let capabilities = read_write_capabilities(&recorder);
            match cd_text_block(&options, &tracks) {
                Some(block) if capabilities.can_write_cd_text() => {
                    let lock = ExclusiveAccess::acquire(&recorder)?;
                    let attempt = win_sao::write_session(
                        &app,
                        &job_id,
                        &recorder,
                        &tracks,
                        Some(&block),
                        options
                            .media_catalog_number
                            .as_deref()
                            .filter(|c| !c.trim().is_empty()),
                        options.gapless,
                        options.test_write,
                        capabilities.buffer_underrun_free,
                        // The IMAPI2 fallback below applies this through
                        // SetWriteSpeed; this path has to ask the drive itself,
                        // and for a while it simply did not — so choosing a
                        // speed with CD-TEXT on, which is the default, changed
                        // nothing about how the disc was burned.
                        options.write_speed,
                        &cancel,
                    );
                    match attempt {
                        Ok(sectors) => {
                            // Verify against the disc rather than trusting the
                            // drive's own claim that it can do this. A failed
                            // query is reported as such, not as an empty disc.
                            let verified =
                                (!options.test_write).then(|| win_sao::verify_cd_text(&recorder));
                            drop(lock);
                            if options.test_write || options.eject_when_done {
                                // See `reload_media`: a rehearsal leaves the drive
                                // holding an unfinished session, and only a reload
                                // makes it call the disc blank again.
                                let _ = recorder.EjectMedia();
                                if options.test_write {
                                    let _ = recorder.CloseTray();
                                }
                            }
                            return Ok(BurnOutcome {
                                sectors,
                                cd_text_written: true,
                                cd_text_verification: verified,
                            });
                        }
                        Err(SaoError::Setup(reason)) => {
                            drop(lock);
                            crate::app_eprintln!(
                                "[burn] CD-TEXT unavailable on this drive, burning without it: {reason}"
                            );
                        }
                        Err(SaoError::Write(reason)) => {
                            drop(lock);
                            return Err(reason);
                        }
                    }
                }
                _ => {
                    crate::app_eprintln!(
                        "[burn] CD-TEXT requested but not possible here; burning without it"
                    );
                }
            }
        }

        // -- Bind the writer ---------------------------------------------
        //
        // Order matters here and it is not obvious. `IDiscFormat2RawCD` --
        // unlike `IDiscFormat2Data`, which prepares internally -- requires an
        // explicit `PrepareMedia` before ANY media-dependent property is
        // touched. Reading `SupportedSectorTypes`, setting
        // `RequestedSectorType`, or asking for `LastPossibleStartOfLeadout`
        // before that fails with IMAPI_E_NOT_PREPARED (0xC0AA0602): none of
        // those questions have an answer until the drive has spun up and read
        // the disc.
        let format: IDiscFormat2RawCD = CoCreateInstance(&MsftDiscFormat2RawCD, None, CLSCTX_ALL)
            .map_err(|e| format!("could not create the CD writer: {e}"))?;
        format
            .SetRecorder(&recorder)
            .map_err(|e| format!("the drive would not accept the job: {e}"))?;
        format
            .SetClientName(&BSTR::from(CLIENT_NAME))
            .map_err(|e| format!("could not identify us to the drive: {e}"))?;

        // Requested before preparing: the speed is applied as the media spins up.
        if let Some(speed) = options.write_speed.filter(|s| *s > 0) {
            // false = CLV/zone-CAV, the safe default for audio.
            let _ = format.SetWriteSpeed(speed as i32, vbool(false));
        }

        let recorder_lock = ExclusiveAccess::acquire(&recorder)?;
        let media = PreparedMedia::prepare(&format)?;

        // -- Media-dependent setup, now the drive has read the disc -------
        //
        // The image and the writer must agree on the sector layout, so the
        // drive's answer decides both.
        let sector_type = choose_sector_type(&format)?;

        format
            .SetRequestedSectorType(sector_type)
            .map_err(|e| format!("the drive rejected the sector format: {e}"))?;

        // -- Build the raw disc image -------------------------------------
        let creator: IRawCDImageCreator =
            CoCreateInstance(&MsftRawCDImageCreator, None, CLSCTX_ALL)
                .map_err(|e| format!("could not create the disc image: {e}"))?;

        // VARIANT_FALSE *enables* gapless -- the property is named for the
        // negative, and getting this backwards costs a disc to discover.
        creator
            .SetDisableGaplessAudio(vbool(!options.gapless))
            .map_err(|e| format!("could not set the gap mode: {e}"))?;

        // Must match what the writer was just told to expect.
        creator
            .SetResultingImageType(sector_type)
            .map_err(|e| format!("could not set the image sector format: {e}"))?;

        let mut sectors_total: u32 = 0;
        for (index, track) in tracks.iter().enumerate() {
            if cancel.load(Ordering::Relaxed) {
                return Err("cancelled".to_string());
            }
            let stream = open_file_stream(&track.path)?;
            let track_index = creator
                .AddTrack(IMAPI_CD_SECTOR_AUDIO, &stream)
                .map_err(|e| format!("could not add track {}: {e}", index + 1))?;
            sectors_total = sectors_total.saturating_add(track.sectors);

            // ISRC, when the library knows one. Best-effort: a malformed code
            // must not cost the user the disc.
            if let Ok(info) = creator.get_TrackInfo(track_index) {
                if let Some(isrc) = track.isrc.as_deref().filter(|s| !s.is_empty()) {
                    let _ = info.SetISRC(&BSTR::from(isrc));
                }
            }
        }

        if let Some(mcn) = options
            .media_catalog_number
            .as_deref()
            .filter(|s| !s.is_empty())
        {
            let _ = creator.SetMediaCatalogNumber(&BSTR::from(mcn));
        }

        // Capacity against the disc actually loaded, now that the rendered
        // lengths are known and the drive has reported its lead-out.
        if let Ok(limit) = format.LastPossibleStartOfLeadout() {
            if limit > 0 && sectors_total > limit as u32 {
                return Err(format!(
                    "This disc holds {limit} sectors but the running order needs \
                     {sectors_total}. Remove a track or use an 80-minute disc."
                ));
            }
        }

        let image = creator
            .CreateResultImage()
            .map_err(|e| format!("could not assemble the disc image: {e}"))?;

        // -- Write ---------------------------------------------------------
        let sink: DDiscFormat2RawCDEvents = WriteSink {
            app: app.clone(),
            job_id: job_id.clone(),
            sectors_total,
            cancel: Arc::clone(&cancel),
            last_emit_ms: AtomicU64::new(0),
            high_water: AtomicI32::new(0),
            warned: AtomicBool::new(false),
            format: format.clone(),
        }
        .into();

        // Progress is a nicety; a drive that refuses the connection point
        // still burns fine, just without a moving ring.
        let _guard = advise_sink(&format, &sink);

        let started = Instant::now();
        let write_result = if options.test_write {
            // Laser off. `IDiscFormat2RawCD` has no simulate flag, so the
            // rehearsal stops here -- but everything up to this point (prepare,
            // sector-type negotiation, capacity, image assembly) has already run
            // against the real disc, which is the point of the test.
            //
            // Nothing is written, so there is no device progress to report and
            // the ring would jump from empty to done. Sweep it instead, over a
            // fixed few seconds rather than the minutes a real burn takes: the
            // rehearsal is over, and making the user watch a fake clock run at
            // 24x would waste their time to no purpose. The UI labels the mode
            // TEST throughout and says nothing was written when it ends.
            sweep_simulated_write(&app, &job_id, sectors_total, &cancel);
            Ok(())
        } else {
            emit_progress(
                &app,
                &job_id,
                BurnPhase::Writing,
                None,
                0,
                sectors_total,
                None,
            );
            format
                .WriteMedia(&image)
                .map_err(|e| describe_write_failure(&e))
        };

        drop(_guard);
        drop(media);
        drop(recorder_lock);

        write_result?;

        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".to_string());
        }

        emit_progress(
            &app,
            &job_id,
            BurnPhase::Closing,
            None,
            sectors_total,
            sectors_total,
            None,
        );

        if options.test_write || options.eject_when_done {
            // A rehearsal leaves the drive holding a session it opened and never
            // closed, so it stops reporting the disc as blank until the medium is
            // reloaded. That is not a convenience eject - it is what keeps the
            // disc usable - so it happens whatever `eject_when_done` says.
            let _ = recorder.EjectMedia();
            if options.test_write {
                let _ = recorder.CloseTray();
            }
        }

        crate::app_deprintln!(
            "[burn] {} {} sectors in {:?}",
            if options.test_write { "rehearsed" } else { "wrote" },
            sectors_total,
            started.elapsed()
        );

        Ok(BurnOutcome {
            sectors: sectors_total,
            cd_text_written: false,
            cd_text_verification: None,
        })
    })
}

/// How long a rehearsal's simulated sweep takes, start to finish.
///
/// Deliberately unrelated to how long the real write would take. This exists so
/// the ring has something to show during a test write, not to impersonate a
/// burn, and eight seconds is long enough to read as motion without holding the
/// user up.
const SIMULATED_SWEEP: Duration = Duration::from_secs(8);

/// Report a test write's progress across the disc.
///
/// The IMAPI2 path cannot rehearse a write — there is no simulate flag on
/// `IDiscFormat2RawCD` — so no sectors are ever committed and the drive has
/// nothing to report. Without this the ring sits empty and then snaps to
/// finished, which looks like a failure rather than a successful rehearsal.
fn sweep_simulated_write(
    app: &AppHandle,
    job_id: &str,
    sectors_total: u32,
    cancel: &Arc<AtomicBool>,
) {
    if sectors_total == 0 {
        return;
    }
    let started = Instant::now();
    loop {
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        let elapsed = started.elapsed();
        if elapsed >= SIMULATED_SWEEP {
            break;
        }
        let fraction = elapsed.as_secs_f64() / SIMULATED_SWEEP.as_secs_f64();
        let done = (f64::from(sectors_total) * fraction) as u32;
        emit_progress(
            app,
            job_id,
            BurnPhase::Writing,
            None,
            done.min(sectors_total),
            sectors_total,
            None,
        );
        std::thread::sleep(Duration::from_millis(PROGRESS_THROTTLE_MS as u64));
    }
    emit_progress(
        app,
        job_id,
        BurnPhase::Writing,
        None,
        sectors_total,
        sectors_total,
        None,
    );
}

/// Assemble the CD-TEXT block for this disc, or `None` when there is nothing
/// worth writing.
fn cd_text_block(options: &BurnOptions, tracks: &[RenderedTrack]) -> Option<CdTextBlock> {
    let input = CdTextInput {
        disc_title: options.disc_title.clone().unwrap_or_default(),
        disc_performer: options.disc_performer.clone().unwrap_or_default(),
        tracks: tracks
            .iter()
            .map(|track| CdTextTrack {
                title: track.title.clone(),
                performer: track.artist.clone(),
            })
            .collect(),
    };
    match CdTextBlock::encode(&input) {
        Ok(block) => Some(block),
        Err(error) => {
            crate::app_eprintln!("[burn] CD-TEXT not written: {error}");
            None
        }
    }
}

/// Holds the media prepared for the duration of a write and always releases it.
///
/// `PrepareMedia` and `ReleaseMedia` must be paired; media left prepared keeps
/// the drive locked until the process exits.
struct PreparedMedia {
    format: IDiscFormat2RawCD,
}

impl PreparedMedia {
    /// # Safety
    /// Must run on the COM-initialised burn thread.
    unsafe fn prepare(format: &IDiscFormat2RawCD) -> Result<Self, String> {
        unsafe {
            format.PrepareMedia().map_err(|e| {
                format!(
                    "the drive could not prepare the disc: {}",
                    describe_write_failure(&e)
                )
            })?;
        }
        Ok(Self {
            format: format.clone(),
        })
    }
}

impl Drop for PreparedMedia {
    fn drop(&mut self) {
        // SAFETY: paired with the PrepareMedia in `prepare`.
        unsafe {
            let _ = self.format.ReleaseMedia();
        }
    }
}

/// Pick a sector layout this drive actually supports.
///
/// The image creator and the writer must agree, so one answer drives both.
/// Preference is widest subcode first, falling back to P-Q, which essentially
/// every CD writer supports. (CD-TEXT does not come through here — it needs a
/// Session-At-Once write, which `win_sao` performs.)
///
/// # Safety
/// Must run on the COM-initialised burn thread, with media already prepared.
unsafe fn choose_sector_type(
    format: &IDiscFormat2RawCD,
) -> Result<IMAPI_FORMAT2_RAW_CD_DATA_SECTOR_TYPE, String> {
    const PREFERENCE: [IMAPI_FORMAT2_RAW_CD_DATA_SECTOR_TYPE; 3] = [
        IMAPI_FORMAT2_RAW_CD_SUBCODE_IS_COOKED,
        IMAPI_FORMAT2_RAW_CD_SUBCODE_IS_RAW,
        IMAPI_FORMAT2_RAW_CD_SUBCODE_PQ_ONLY,
    ];

    // SAFETY: media is prepared, so the drive can answer this.
    let supported = unsafe {
        format
            .SupportedSectorTypes()
            .map(|psa| safearray_i32s(psa))
            .unwrap_or_default()
    };

    if supported.is_empty() {
        // Nothing reported -- fall back to the most widely implemented layout
        // rather than refusing outright.
        return Ok(IMAPI_FORMAT2_RAW_CD_SUBCODE_PQ_ONLY);
    }

    PREFERENCE
        .into_iter()
        .find(|candidate| supported.contains(&candidate.0))
        .ok_or_else(|| {
            "This drive does not support any raw audio-CD sector format Psysonic can write."
                .to_string()
        })
}

/// Hook the sink up to the writer's connection point.
///
/// # Safety
/// Must run on the COM-initialised burn thread.
unsafe fn advise_sink(
    format: &IDiscFormat2RawCD,
    sink: &DDiscFormat2RawCDEvents,
) -> Option<SinkGuard> {
    unsafe {
        let container = match format.cast::<IConnectionPointContainer>() {
            Ok(container) => container,
            Err(error) => {
                crate::app_eprintln!("[burn] writer exposes no connection points: {error}");
                return None;
            }
        };
        let point = match container.FindConnectionPoint(&DDiscFormat2RawCDEvents::IID) {
            Ok(point) => point,
            Err(error) => {
                crate::app_eprintln!("[burn] no progress connection point: {error}");
                return None;
            }
        };
        let cookie = match point.Advise(sink) {
            Ok(cookie) => cookie,
            Err(error) => {
                crate::app_eprintln!("[burn] could not subscribe to progress: {error}");
                return None;
            }
        };
        Some(SinkGuard { point, cookie })
    }
}

/// Holds the drive for the duration of a write and always gives it back.
struct ExclusiveAccess {
    recorder: IDiscRecorder2,
}

impl ExclusiveAccess {
    /// # Safety
    /// Must run on the COM-initialised burn thread.
    unsafe fn acquire(recorder: &IDiscRecorder2) -> Result<Self, String> {
        unsafe {
            recorder
                .AcquireExclusiveAccess(vbool(false), &BSTR::from(CLIENT_NAME))
                .map_err(|e| {
                    let owner = recorder
                        .ExclusiveAccessOwner()
                        .map(|o| o.to_string())
                        .unwrap_or_default();
                    if owner.is_empty() {
                        format!("another program is using the drive: {e}")
                    } else {
                        format!("{owner} is using the drive — close it and try again")
                    }
                })?;
        }
        Ok(Self {
            recorder: recorder.clone(),
        })
    }
}

impl Drop for ExclusiveAccess {
    fn drop(&mut self) {
        // SAFETY: paired with the AcquireExclusiveAccess in `acquire`.
        unsafe {
            let _ = self.recorder.ReleaseExclusiveAccess();
        }
    }
}

/// Translate the IMAPI2 failures a user can actually act on.
fn describe_write_failure(error: &windows_core::Error) -> String {
    // IMAPI2 error codes, from imapi2error.h.
    const E_MEDIUM_NOT_PRESENT: i32 = 0xC0AA0202_u32 as i32;
    const E_MEDIUM_INVALID_TYPE: i32 = 0xC0AA0203_u32 as i32;
    const E_WRITE_NOT_SUPPORTED: i32 = 0xC0AA0207_u32 as i32;
    const E_LOSS_OF_STREAMING: i32 = 0xC0AA0301_u32 as i32;
    const E_MEDIUM_WRITE_PROTECTED: i32 = 0xC0AA0206_u32 as i32;
    const E_NOT_PREPARED: i32 = 0xC0AA0602_u32 as i32;

    match error.code().0 {
        E_MEDIUM_NOT_PRESENT => "The disc was removed during the burn.".to_string(),
        E_MEDIUM_INVALID_TYPE => {
            "That disc cannot hold an audio CD. Use a blank CD-R or CD-RW.".to_string()
        }
        E_WRITE_NOT_SUPPORTED => "This drive cannot write discs.".to_string(),
        E_MEDIUM_WRITE_PROTECTED => "The disc is write-protected.".to_string(),
        E_NOT_PREPARED => {
            "The drive could not read the disc. Reseat it, or try a different blank."
                .to_string()
        }
        E_LOSS_OF_STREAMING => {
            "The drive ran out of data mid-burn (buffer underrun). Try a slower write speed."
                .to_string()
        }
        _ => format!("The burn failed: {error}"),
    }
}

/// Wrap a rendered PCM file as a read-only COM stream for IMAPI2.
///
/// # Safety
/// Must run on the COM-initialised burn thread.
unsafe fn open_file_stream(path: &Path) -> Result<IStream, String> {
    let wide = HSTRING::from(path.as_os_str());
    // SAFETY: `wide` outlives the call; IMAPI2 takes its own reference on the
    // returned stream.
    unsafe {
        SHCreateStreamOnFileEx(
            PCWSTR(wide.as_ptr()),
            STGM_READ.0,
            0,
            false,
            None,
        )
        .map_err(|e| format!("could not read the rendered track {}: {e}", path.display()))
    }
}

// ── Erase (CD-RW) ────────────────────────────────────────────────────────────

/// Eject the disc and pull it back in, so the drive re-reads it.
///
/// Drive-side media state survives a rehearsal: the disc is untouched but the
/// drive keeps describing it as it did when the test finished. A reload is the
/// one thing that reliably clears that, and without it a CD-R that reports
/// non-blank has no way back — erase is CD-RW only.
pub fn reload_media(recorder_id: &str) -> Result<(), String> {
    let recorder_id = recorder_id.to_string();
    with_com(move || unsafe {
        let recorder = open_recorder(&recorder_id)?;
        recorder
            .EjectMedia()
            .map_err(|e| format!("the drive would not eject the disc: {e}"))?;
        // Slot and slim drives often have no motorised tray; the disc is out,
        // which is enough for the user to push it back in themselves.
        let _ = recorder.CloseTray();
        Ok(())
    })
}

pub fn erase(recorder_id: &str, quick: bool) -> Result<(), String> {
    let recorder_id = recorder_id.to_string();
    with_com(move || unsafe {
        let recorder = open_recorder(&recorder_id)?;

        let eraser: IDiscFormat2Erase = CoCreateInstance(&MsftDiscFormat2Erase, None, CLSCTX_ALL)
            .map_err(|e| format!("could not create the eraser: {e}"))?;
        eraser
            .SetRecorder(&recorder)
            .map_err(|e| format!("the drive would not accept the erase: {e}"))?;
        eraser
            .SetClientName(&BSTR::from(CLIENT_NAME))
            .map_err(|e| format!("could not identify us to the drive: {e}"))?;
        eraser
            .SetFullErase(vbool(!quick))
            .map_err(|e| format!("could not choose the erase mode: {e}"))?;

        let lock = ExclusiveAccess::acquire(&recorder)?;
        let result = eraser
            .EraseMedia()
            .map_err(|e| format!("the erase failed: {e}"));
        drop(lock);
        result
    })
}
