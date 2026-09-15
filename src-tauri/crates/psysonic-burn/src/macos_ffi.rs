//! Raw bindings to `CoreFoundation` and `DiscRecording.framework`.
//!
//! Deliberately mechanical: declarations, a couple of RAII wrappers, and
//! nothing that makes a decision. Every judgement about burning lives in
//! `macos.rs` above this, which is the mitigation for the fact that a
//! hand-written FFI surface is unchecked by the compiler.
//!
//! **Why the C API and not Objective-C.** `DiscRecording` ships two parallel
//! surfaces: the Objective-C classes (`DRBurn`, `DRTrack`, …) and the
//! CoreFoundation-level `DRCore*` C functions the classes are built on. The C
//! surface needs no `objc2` runtime, no `extern_class!`/`msg_send!`
//! boilerplate, and no `build.rs` — a `#[link]` attribute and plain
//! declarations reach it. It is also strictly larger: the audio-file
//! convenience constructor the Objective-C side once had (`DRAudioTrack`) no
//! longer exists in the SDK, so both surfaces require a track producer
//! callback, and here that callback is an ordinary `extern "C"` function
//! pointer.
//!
//! Verified against the SDK headers in
//! `DiscRecording.framework/Headers/DRCore*.h` and exercised against the live
//! framework before being written.

#![allow(non_upper_case_globals, non_snake_case)]

use std::ffi::c_void;

// ── CoreFoundation ───────────────────────────────────────────────────────────

pub type CFTypeRef = *const c_void;
pub type CFStringRef = CFTypeRef;
pub type CFArrayRef = CFTypeRef;
pub type CFMutableArrayRef = *mut c_void;
pub type CFDictionaryRef = CFTypeRef;
pub type CFMutableDictionaryRef = *mut c_void;
pub type CFNumberRef = CFTypeRef;
pub type CFBooleanRef = CFTypeRef;
pub type CFDataRef = CFTypeRef;
pub type CFAllocatorRef = CFTypeRef;

/// `signed long` on every Apple 64-bit platform.
pub type CFIndex = isize;
/// `unsigned char`, not Rust's `bool`.
pub type CFBoolean = u8;
pub type CFStringEncoding = u32;
pub type CFNumberType = CFIndex;
pub type OSStatus = i32;

pub const kCFNumberSInt32Type: CFNumberType = 3;
pub const kCFNumberSInt64Type: CFNumberType = 4;
pub const kCFNumberFloatType: CFNumberType = 12;
pub const kCFNumberDoubleType: CFNumberType = 13;

pub const kCFStringEncodingISOLatin1: CFStringEncoding = 0x0201;
pub const kCFStringEncodingUTF8: CFStringEncoding = 0x0800_0100;

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    pub static kCFTypeDictionaryKeyCallBacks: c_void;
    pub static kCFTypeDictionaryValueCallBacks: c_void;
    pub static kCFTypeArrayCallBacks: c_void;

    pub fn CFRelease(cf: CFTypeRef);

    pub fn CFArrayGetCount(array: CFArrayRef) -> CFIndex;
    pub fn CFArrayGetValueAtIndex(array: CFArrayRef, idx: CFIndex) -> CFTypeRef;
    pub fn CFArrayCreateMutable(
        allocator: CFAllocatorRef,
        capacity: CFIndex,
        callbacks: *const c_void,
    ) -> CFMutableArrayRef;
    pub fn CFArrayAppendValue(array: CFMutableArrayRef, value: CFTypeRef);

    pub fn CFDictionaryGetValue(dict: CFDictionaryRef, key: CFTypeRef) -> CFTypeRef;
    pub fn CFDictionaryCreateMutable(
        allocator: CFAllocatorRef,
        capacity: CFIndex,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> CFMutableDictionaryRef;
    pub fn CFDictionarySetValue(dict: CFMutableDictionaryRef, key: CFTypeRef, value: CFTypeRef);

    pub fn CFStringCreateWithBytes(
        allocator: CFAllocatorRef,
        bytes: *const u8,
        num_bytes: CFIndex,
        encoding: CFStringEncoding,
        is_external_representation: CFBoolean,
    ) -> CFStringRef;
    pub fn CFStringGetLength(s: CFStringRef) -> CFIndex;
    pub fn CFStringGetCString(
        s: CFStringRef,
        buffer: *mut u8,
        buffer_size: CFIndex,
        encoding: CFStringEncoding,
    ) -> CFBoolean;
    pub fn CFStringCompare(a: CFStringRef, b: CFStringRef, options: CFIndex) -> CFIndex;

    pub fn CFNumberCreate(
        allocator: CFAllocatorRef,
        number_type: CFNumberType,
        value_ptr: *const c_void,
    ) -> CFNumberRef;
    pub fn CFNumberGetValue(
        number: CFNumberRef,
        number_type: CFNumberType,
        value_ptr: *mut c_void,
    ) -> CFBoolean;

    pub fn CFBooleanGetValue(b: CFBooleanRef) -> CFBoolean;
    pub static kCFBooleanTrue: CFBooleanRef;
    pub static kCFBooleanFalse: CFBooleanRef;

    pub fn CFDataCreate(
        allocator: CFAllocatorRef,
        bytes: *const u8,
        length: CFIndex,
    ) -> CFDataRef;

    pub fn CFGetTypeID(cf: CFTypeRef) -> usize;
    pub fn CFNumberGetTypeID() -> usize;
    pub fn CFStringGetTypeID() -> usize;
    pub fn CFBooleanGetTypeID() -> usize;
}

// ── DiscRecording ────────────────────────────────────────────────────────────

pub type DRDeviceRef = CFTypeRef;
pub type DRBurnRef = CFTypeRef;
pub type DREraseRef = CFTypeRef;
pub type DRTrackRef = CFTypeRef;
pub type DRCDTextBlockRef = CFTypeRef;

pub type DRTrackMessage = u32;

/// Parameter block for `kDRTrackMessageProduceData`.
///
/// Layout mirrors `DRTrackProductionInfo` in `DRCoreTrack.h`; the field order
/// and widths are load-bearing.
#[repr(C)]
pub struct DRTrackProductionInfo {
    pub buffer: *mut c_void,
    pub req_count: u32,
    pub act_count: u32,
    pub flags: u32,
    pub block_size: u32,
    pub requested_address: u64,
}

pub type DRTrackCallbackProc =
    unsafe extern "C" fn(track: DRTrackRef, message: DRTrackMessage, io_param: *mut c_void) -> OSStatus;

// Track messages. Four-character codes, big-endian as written in the header.
pub const kDRTrackMessagePreBurn: DRTrackMessage = 0x7072_6520; // 'pre '
pub const kDRTrackMessageProduceData: DRTrackMessage = 0x7072_6F64; // 'prod'
pub const kDRTrackMessagePostBurn: DRTrackMessage = 0x706F_7374; // 'post'
pub const kDRTrackMessageEstimateLength: DRTrackMessage = 0x6573_7469; // 'esti'

// Track production flags.
pub const kDRFlagNoMoreData: u32 = 1 << 0;
pub const kDRFlagSubchannelDataRequested: u32 = 1 << 1;

// Audio track geometry, from the Block Sizes / Block Types / Data Forms /
// Track Modes / Session Format enumerations in `DRCoreTrack.h`.
pub const kDRBlockSizeAudio: i32 = 2352;
pub const kDRBlockTypeAudio: i32 = 0;
pub const kDRDataFormAudio: i32 = 0;
pub const kDRTrackModeAudio: i32 = 0;
pub const kDRSessionFormatAudio: i32 = 0;

// CD-Text encodings, from `DRCoreCDText.h`. Latin-1 is what CD-TEXT players
// expect and what the shared encoder already targets.
pub const kDRCDTextEncodingISOLatin1Modified: CFStringEncoding = kCFStringEncodingISOLatin1;

// Error codes from `DRCoreErrors.h`. Declared as `0x8002xxxx` unsigned there,
// which is negative once it reaches an `OSStatus`.
pub const kDRDeviceAccessErr: OSStatus = 0x8002_0020_u32 as OSStatus;
pub const kDRDeviceBusyErr: OSStatus = 0x8002_0021_u32 as OSStatus;
pub const kDRDeviceCommunicationErr: OSStatus = 0x8002_0022_u32 as OSStatus;
pub const kDRDeviceInvalidErr: OSStatus = 0x8002_0023_u32 as OSStatus;
pub const kDRDeviceNotReadyErr: OSStatus = 0x8002_0024_u32 as OSStatus;
pub const kDRDeviceNotSupportedErr: OSStatus = 0x8002_0025_u32 as OSStatus;
pub const kDRMediaBusyErr: OSStatus = 0x8002_0040_u32 as OSStatus;
pub const kDRMediaNotPresentErr: OSStatus = 0x8002_0041_u32 as OSStatus;
pub const kDRMediaNotWritableErr: OSStatus = 0x8002_0042_u32 as OSStatus;
pub const kDRMediaNotSupportedErr: OSStatus = 0x8002_0043_u32 as OSStatus;
pub const kDRMediaNotBlankErr: OSStatus = 0x8002_0044_u32 as OSStatus;
pub const kDRMediaNotErasableErr: OSStatus = 0x8002_0045_u32 as OSStatus;
pub const kDRMediaInvalidErr: OSStatus = 0x8002_0046_u32 as OSStatus;
pub const kDRBurnUnderrunErr: OSStatus = 0x8002_0060_u32 as OSStatus;
pub const kDRBurnNotAllowedErr: OSStatus = 0x8002_0061_u32 as OSStatus;
pub const kDRDataProductionErr: OSStatus = 0x8002_0062_u32 as OSStatus;
pub const kDRUserCanceledErr: OSStatus = 0x8002_0066_u32 as OSStatus;
pub const kDRFunctionNotSupportedErr: OSStatus = 0x8002_0067_u32 as OSStatus;
pub const kDRBurnPowerCalibrationErr: OSStatus = 0x8002_006D_u32 as OSStatus;
pub const kDRBurnMediaWriteFailureErr: OSStatus = 0x8002_006E_u32 as OSStatus;
pub const kDRDeviceBurnStrategyNotAvailableErr: OSStatus = 0x8002_0200_u32 as OSStatus;
pub const kDRDeviceCantWriteCDTextErr: OSStatus = 0x8002_0201_u32 as OSStatus;
pub const kDRDeviceCantWriteISRCErr: OSStatus = 0x8002_0203_u32 as OSStatus;

#[link(name = "DiscRecording", kind = "framework")]
unsafe extern "C" {
    // Devices
    pub fn DRCopyDeviceArray() -> CFArrayRef;
    pub fn DRDeviceCopyDeviceForIORegistryEntryPath(path: CFStringRef) -> DRDeviceRef;
    pub fn DRDeviceIsValid(device: DRDeviceRef) -> CFBoolean;
    pub fn DRDeviceCopyInfo(device: DRDeviceRef) -> CFDictionaryRef;
    pub fn DRDeviceCopyStatus(device: DRDeviceRef) -> CFDictionaryRef;
    pub fn DRDeviceAcquireMediaReservation(device: DRDeviceRef);
    pub fn DRDeviceReleaseMediaReservation(device: DRDeviceRef);

    // Burns
    pub fn DRBurnCreate(device: DRDeviceRef) -> DRBurnRef;
    pub fn DRBurnSetProperties(burn: DRBurnRef, properties: CFDictionaryRef);
    pub fn DRBurnWriteLayout(burn: DRBurnRef, layout: CFTypeRef) -> OSStatus;
    pub fn DRBurnAbort(burn: DRBurnRef);
    pub fn DRBurnCopyStatus(burn: DRBurnRef) -> CFDictionaryRef;

    // Erases
    pub fn DREraseCreate(device: DRDeviceRef) -> DREraseRef;
    pub fn DREraseSetProperties(erase: DREraseRef, properties: CFDictionaryRef);
    pub fn DREraseStart(erase: DREraseRef) -> OSStatus;
    pub fn DREraseCopyStatus(erase: DREraseRef) -> CFDictionaryRef;

    // Tracks
    pub fn DRTrackCreate(properties: CFDictionaryRef, callback: DRTrackCallbackProc) -> DRTrackRef;

    // CD-Text
    pub fn DRCDTextBlockCreate(
        language: CFStringRef,
        encoding: CFStringEncoding,
    ) -> DRCDTextBlockRef;
    pub fn DRCDTextBlockSetValue(
        block: DRCDTextBlockRef,
        track_index: CFIndex,
        key: CFStringRef,
        value: CFTypeRef,
    );
    pub fn DRCDTextBlockFlatten(block: DRCDTextBlockRef) -> u32;

    // ── Device info dictionary keys (DRDeviceCopyInfo) ───────────────────
    pub static kDRDeviceIORegistryEntryPathKey: CFStringRef;
    pub static kDRDeviceVendorNameKey: CFStringRef;
    pub static kDRDeviceProductNameKey: CFStringRef;
    pub static kDRDeviceWriteCapabilitiesKey: CFStringRef;

    // ── Write-capability keys (inside kDRDeviceWriteCapabilitiesKey) ─────
    pub static kDRDeviceCanWriteCDRKey: CFStringRef;
    pub static kDRDeviceCanWriteCDRWKey: CFStringRef;
    pub static kDRDeviceCanWriteCDTextKey: CFStringRef;
    pub static kDRDeviceCanWriteCDSAOKey: CFStringRef;
    pub static kDRDeviceCanWriteCDRawKey: CFStringRef;
    pub static kDRDeviceCanWriteISRCKey: CFStringRef;
    pub static kDRDeviceCanTestWriteCDKey: CFStringRef;
    pub static kDRDeviceCanUnderrunProtectCDKey: CFStringRef;

    // ── Device status dictionary keys (DRDeviceCopyStatus) ───────────────
    pub static kDRDeviceMediaStateKey: CFStringRef;
    pub static kDRDeviceMediaStateMediaPresent: CFStringRef;
    pub static kDRDeviceMediaInfoKey: CFStringRef;
    pub static kDRDeviceBurnSpeedsKey: CFStringRef;

    // ── Media info sub-dictionary keys ───────────────────────────────────
    pub static kDRDeviceMediaBSDNameKey: CFStringRef;
    pub static kDRDeviceMediaIsBlankKey: CFStringRef;
    pub static kDRDeviceMediaIsErasableKey: CFStringRef;
    pub static kDRDeviceMediaBlocksFreeKey: CFStringRef;
    pub static kDRDeviceMediaClassKey: CFStringRef;
    pub static kDRDeviceMediaClassCD: CFStringRef;
    pub static kDRDeviceMediaTypeKey: CFStringRef;
    pub static kDRDeviceMediaTypeCDROM: CFStringRef;
    pub static kDRDeviceMediaTypeCDR: CFStringRef;
    pub static kDRDeviceMediaTypeCDRW: CFStringRef;

    // ── Burn property keys ───────────────────────────────────────────────
    pub static kDRBurnRequestedSpeedKey: CFStringRef;
    pub static kDRBurnAppendableKey: CFStringRef;
    pub static kDRBurnVerifyDiscKey: CFStringRef;
    pub static kDRBurnCompletionActionKey: CFStringRef;
    pub static kDRBurnCompletionActionEject: CFStringRef;
    pub static kDRBurnCompletionActionMount: CFStringRef;
    pub static kDRBurnFailureActionKey: CFStringRef;
    pub static kDRBurnFailureActionNone: CFStringRef;
    pub static kDRBurnUnderrunProtectionKey: CFStringRef;
    pub static kDRBurnTestingKey: CFStringRef;
    pub static kDRSynchronousBehaviorKey: CFStringRef;
    pub static kDRMediaCatalogNumberKey: CFStringRef;
    pub static kDRBurnStrategyKey: CFStringRef;
    pub static kDRBurnStrategyCDSAO: CFStringRef;
    pub static kDRCDTextKey: CFStringRef;

    // ── Track property keys ──────────────────────────────────────────────
    pub static kDRTrackLengthKey: CFStringRef;
    pub static kDRBlockSizeKey: CFStringRef;
    pub static kDRBlockTypeKey: CFStringRef;
    pub static kDRDataFormKey: CFStringRef;
    pub static kDRSessionFormatKey: CFStringRef;
    pub static kDRTrackModeKey: CFStringRef;
    pub static kDRVerificationTypeKey: CFStringRef;
    pub static kDRVerificationTypeNone: CFStringRef;
    pub static kDRPreGapLengthKey: CFStringRef;
    pub static kDRTrackISRCKey: CFStringRef;
    pub static kDRAudioPreEmphasisKey: CFStringRef;

    // ── Status dictionary keys ───────────────────────────────────────────
    pub static kDRStatusStateKey: CFStringRef;
    pub static kDRStatusPercentCompleteKey: CFStringRef;
    pub static kDRStatusCurrentTrackKey: CFStringRef;
    pub static kDRStatusStateNone: CFStringRef;
    pub static kDRStatusStatePreparing: CFStringRef;
    pub static kDRStatusStateSessionOpen: CFStringRef;
    pub static kDRStatusStateTrackOpen: CFStringRef;
    pub static kDRStatusStateTrackWrite: CFStringRef;
    pub static kDRStatusStateTrackClose: CFStringRef;
    pub static kDRStatusStateSessionClose: CFStringRef;
    pub static kDRStatusStateFinishing: CFStringRef;
    pub static kDRStatusStateVerifying: CFStringRef;
    pub static kDRStatusStateDone: CFStringRef;
    pub static kDRStatusStateFailed: CFStringRef;

    // ── Error status keys ────────────────────────────────────────────────
    pub static kDRErrorStatusKey: CFStringRef;
    pub static kDRErrorStatusErrorKey: CFStringRef;
    pub static kDRErrorStatusErrorStringKey: CFStringRef;
    pub static kDRErrorStatusErrorInfoStringKey: CFStringRef;

    // ── Erase property keys ──────────────────────────────────────────────
    pub static kDREraseTypeKey: CFStringRef;
    pub static kDREraseTypeQuick: CFStringRef;
    pub static kDREraseTypeComplete: CFStringRef;

    // ── CD-Text keys ─────────────────────────────────────────────────────
    pub static kDRCDTextTitleKey: CFStringRef;
    pub static kDRCDTextPerformerKey: CFStringRef;
}

// Only used to prove, from a test, that the framework really does dispatch
// `kDRTrackMessageEstimateLength` to our producer, and that what we put into a
// CD-Text block is what comes back out.
#[cfg(test)]
#[link(name = "DiscRecording", kind = "framework")]
unsafe extern "C" {
    pub fn DRTrackEstimateLength(track: DRTrackRef) -> u64;
    pub fn DRCDTextBlockGetValue(
        block: DRCDTextBlockRef,
        track_index: CFIndex,
        key: CFStringRef,
    ) -> CFTypeRef;
}

// ── Safe-ish helpers ─────────────────────────────────────────────────────────
//
// Still mechanical: ownership bookkeeping and type coercion, no decisions.

/// A CoreFoundation object we own a reference to, released on drop.
///
/// Only wrap the result of a `Create`/`Copy` function — anything from a `Get`
/// is borrowed and must not be released.
pub struct CfOwned(CFTypeRef);

impl CfOwned {
    /// # Safety
    /// `raw` must carry a +1 reference this wrapper may consume, or be null.
    pub unsafe fn from_create(raw: CFTypeRef) -> Option<Self> {
        if raw.is_null() {
            None
        } else {
            Some(Self(raw))
        }
    }

    pub fn get(&self) -> CFTypeRef {
        self.0
    }
}

impl Drop for CfOwned {
    fn drop(&mut self) {
        // SAFETY: `from_create` only ever stores a non-null +1 reference.
        unsafe { CFRelease(self.0) };
    }
}

/// UTF-8 `&str` → `CFString`.
pub fn cf_string(text: &str) -> Option<CfOwned> {
    // SAFETY: the byte slice is valid for the duration of the call, and
    // CFString copies it.
    unsafe {
        CfOwned::from_create(CFStringCreateWithBytes(
            std::ptr::null(),
            text.as_ptr(),
            text.len() as CFIndex,
            kCFStringEncodingUTF8,
            0,
        ))
    }
}

/// ISO-8859-1 bytes → `CFString`.
///
/// Used for CD-TEXT, where the shared encoder has already transliterated to
/// Latin-1 and handing those bytes over directly avoids a lossy round trip.
pub fn cf_string_latin1(bytes: &[u8]) -> Option<CfOwned> {
    // SAFETY: as above.
    unsafe {
        CfOwned::from_create(CFStringCreateWithBytes(
            std::ptr::null(),
            bytes.as_ptr(),
            bytes.len() as CFIndex,
            kCFStringEncodingISOLatin1,
            0,
        ))
    }
}

/// `CFString` → `String`, or `None` when it is not a string or will not
/// convert.
///
/// # Safety
/// `value` must be null or a valid CoreFoundation object.
pub unsafe fn cf_to_string(value: CFTypeRef) -> Option<String> {
    unsafe {
        if value.is_null() || CFGetTypeID(value) != CFStringGetTypeID() {
            return None;
        }
        // Worst case for UTF-8 is 4 bytes per UTF-16 unit, plus the NUL.
        let capacity = (CFStringGetLength(value) * 4 + 1).max(1) as usize;
        let mut buffer = vec![0_u8; capacity];
        if CFStringGetCString(
            value,
            buffer.as_mut_ptr(),
            capacity as CFIndex,
            kCFStringEncodingUTF8,
        ) == 0
        {
            return None;
        }
        let end = buffer.iter().position(|b| *b == 0).unwrap_or(0);
        buffer.truncate(end);
        String::from_utf8(buffer).ok()
    }
}

/// Do two `CFString`s hold the same text? Used to compare against the
/// framework's own constants, which are not pointer-stable.
///
/// # Safety
/// Both arguments must be null or valid `CFString`s.
pub unsafe fn cf_string_eq(a: CFStringRef, b: CFStringRef) -> bool {
    unsafe {
        if a.is_null() || b.is_null() {
            return false;
        }
        CFStringCompare(a, b, 0) == 0
    }
}

pub fn cf_number_i32(value: i32) -> Option<CfOwned> {
    // SAFETY: `value` outlives the call; CFNumber copies it.
    unsafe {
        CfOwned::from_create(CFNumberCreate(
            std::ptr::null(),
            kCFNumberSInt32Type,
            (&raw const value).cast(),
        ))
    }
}

pub fn cf_number_i64(value: i64) -> Option<CfOwned> {
    // SAFETY: as above.
    unsafe {
        CfOwned::from_create(CFNumberCreate(
            std::ptr::null(),
            kCFNumberSInt64Type,
            (&raw const value).cast(),
        ))
    }
}

pub fn cf_number_f32(value: f32) -> Option<CfOwned> {
    // SAFETY: as above.
    unsafe {
        CfOwned::from_create(CFNumberCreate(
            std::ptr::null(),
            kCFNumberFloatType,
            (&raw const value).cast(),
        ))
    }
}

pub fn cf_data(bytes: &[u8]) -> Option<CfOwned> {
    // SAFETY: the slice is valid for the call; CFData copies it.
    unsafe {
        CfOwned::from_create(CFDataCreate(
            std::ptr::null(),
            bytes.as_ptr(),
            bytes.len() as CFIndex,
        ))
    }
}

/// The shared `kCFBooleanTrue` / `kCFBooleanFalse`. Borrowed — never release.
pub fn cf_bool(value: bool) -> CFBooleanRef {
    // SAFETY: reading two constant globals exported by CoreFoundation.
    unsafe {
        if value {
            kCFBooleanTrue
        } else {
            kCFBooleanFalse
        }
    }
}

/// Borrowed value out of a dictionary, or null.
///
/// # Safety
/// `dict` must be null or a valid `CFDictionary`.
pub unsafe fn dict_get(dict: CFDictionaryRef, key: CFStringRef) -> CFTypeRef {
    unsafe {
        if dict.is_null() || key.is_null() {
            return std::ptr::null();
        }
        CFDictionaryGetValue(dict, key)
    }
}

/// # Safety
/// `dict` must be null or a valid `CFDictionary`.
pub unsafe fn dict_bool(dict: CFDictionaryRef, key: CFStringRef) -> Option<bool> {
    unsafe {
        let value = dict_get(dict, key);
        if value.is_null() || CFGetTypeID(value) != CFBooleanGetTypeID() {
            return None;
        }
        Some(CFBooleanGetValue(value) != 0)
    }
}

/// # Safety
/// `dict` must be null or a valid `CFDictionary`.
pub unsafe fn dict_i64(dict: CFDictionaryRef, key: CFStringRef) -> Option<i64> {
    unsafe {
        let value = dict_get(dict, key);
        if value.is_null() || CFGetTypeID(value) != CFNumberGetTypeID() {
            return None;
        }
        let mut out: i64 = 0;
        if CFNumberGetValue(value, kCFNumberSInt64Type, (&raw mut out).cast()) == 0 {
            return None;
        }
        Some(out)
    }
}

/// # Safety
/// `dict` must be null or a valid `CFDictionary`.
pub unsafe fn dict_f64(dict: CFDictionaryRef, key: CFStringRef) -> Option<f64> {
    unsafe {
        let value = dict_get(dict, key);
        if value.is_null() || CFGetTypeID(value) != CFNumberGetTypeID() {
            return None;
        }
        let mut out: f64 = 0.0;
        if CFNumberGetValue(value, kCFNumberDoubleType, (&raw mut out).cast()) == 0 {
            return None;
        }
        Some(out)
    }
}

/// # Safety
/// `dict` must be null or a valid `CFDictionary`.
pub unsafe fn dict_string(dict: CFDictionaryRef, key: CFStringRef) -> Option<String> {
    unsafe { cf_to_string(dict_get(dict, key)) }
}

/// A `CFNumber` in an array element, coerced to `f64`.
///
/// # Safety
/// `value` must be null or a valid CoreFoundation object.
pub unsafe fn cf_to_f64(value: CFTypeRef) -> Option<f64> {
    unsafe {
        if value.is_null() || CFGetTypeID(value) != CFNumberGetTypeID() {
            return None;
        }
        let mut out: f64 = 0.0;
        if CFNumberGetValue(value, kCFNumberDoubleType, (&raw mut out).cast()) == 0 {
            return None;
        }
        Some(out)
    }
}
