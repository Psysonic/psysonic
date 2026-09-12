# CD Burner on macOS — as built

**Status:** implemented and verified on hardware — a disc was burned and its
CD-TEXT read back off it. `clippy -D warnings` clean, 18 tests, and the binding
layer is exercised against the live framework.

Read [`README.md`](./README.md) first: the architecture, the audio pipeline and
the CD-TEXT format all carry over unchanged. This file covers only what is
different on macOS.

---

## 1. What was built

Two source files and a smoke test. No new dependencies, no `build.rs`:

| File | Lines | What |
| --- | --- | --- |
| `macos_ffi.rs` | 591 | `extern "C"` declarations + CF ownership helpers |
| `macos.rs` | 1,369 + 306 tests | the four entry points, plus the track producer |
| `tests/macos_smoke.rs` | 38 | enumeration against the live framework |

`platform.rs` gained a `#[cfg(target_os = "macos")]` arm per entry point.
`cdtext/mod.rs` re-exports `to_latin1`. Nothing else in the shared layers
changed — in particular **`render.rs` was not touched**.

## 2. macOS is the simple platform

None of the hard Windows work applies. No MMC passthrough, no `SEND CUE SHEET`,
no mode page `05h`, no raw P-W packing, no CRC, no SIZE_INFO. You hand
`DiscRecording` a `DRCDTextBlockRef` on the burn's property dictionary and it
writes the lead-in.

## 3. Use the C API, not objc2

`DiscRecording` ships a complete **CoreFoundation-level C API** —
`DRCoreBurn.h`, `DRCoreDevice.h`, `DRCoreTrack.h`, `DRCoreCDText.h`,
`DRCoreErase.h`, `DRCoreStatus.h` — which is what the Objective-C classes are
built on. Reaching it needs a `#[link]` attribute and plain `extern "C"`
declarations: no objc2 runtime, no `extern_class!` / `msg_send!` boilerplate, no
`build.rs`, and **no new crate dependencies at all**.

It is also the larger surface. Prefer it.

## 4. Tracks are produced by callback, not from a file

**`DRAudioTrack` does not exist in the current SDK.** `DRTrack.h` has no
`trackForAudioFile:`, and `DRTrackCreate` — which takes a properties dictionary
and a `DRTrackCallbackProc` — is the only track constructor either surface still
offers. Writing a 44-byte WAV header at render time and handing over a file is
not an available route.

That is the route to want anyway. A `DRTrackCallbackProc` is an ordinary
`extern "C"` function pointer, and `render.rs` already produces exactly what it
must supply: headerless, sector-aligned, 44.1 kHz/16-bit/stereo PCM. A WAV
variant would have meant a `cfg`-gated divergence inside the shared render path;
the callback means none.

The callback has no user-data pointer — it gets only the `DRTrackRef` — so
producer state lives in a registry keyed by the track's address, cleaned up by
`TrackSet`'s `Drop` **before** the tracks are released, so an address cannot be
recycled onto a stale entry.

## 5. Transliterate before the framework sees a string

The framework **substitutes**; it does not transliterate. Measured against it,
`Żubr Kolektyw — ぁ` comes back as `?ubr Kolektyw -- ?`, where the shared encoder
gives `Zubr Kolektyw`. So running `cdtext::encode::to_latin1` as a pre-pass is a
real quality improvement rather than a cross-platform consistency nicety, and
`macos.rs` does it before a single string reaches the framework.

## 6. Traps in the property dictionaries

**Two keys fail the whole burn on an incapable drive.** `kDRTrackISRCKey`
(`kDRDeviceCantWriteISRCErr`) and `kDRCDTextKey` (`kDRDeviceCantWriteCDTextErr`)
are both all-or-nothing. Each is gated on the drive's own write-capabilities
dictionary before being attached — the macOS equivalent of the Windows
`SaoError::Setup` fallback: a drive that cannot do CD-TEXT gets a normal disc
rather than a refusal.

**CD-TEXT attaches via `kDRCDTextKey`**, in the dictionary passed to
`DRBurnSetProperties`. It takes a `DRCDTextBlockRef` or an array of them.
Track-At-Once cannot carry CD-TEXT, so the burn also asks for
`kDRBurnStrategyCDSAO` — as a suggestion only, since
`kDRBurnStrategyIsRequiredKey` is left unset, so a drive that reaches the same
result another way still burns.

**`kDRBurnTestingKey` is a real laser-off rehearsal**, and better than the
Windows equivalent: `IDiscFormat2RawCD` exposes no simulate flag, so the IMAPI2
rehearsal stops before `WriteMedia`, whereas here the entire write runs. With
one trap — the header states that if the drive cannot test-burn, "the burn will
default to a value of `false` and a normal burn will occur". It silently turns a
rehearsal into a permanent disc. So `burn` refuses up front when `test_write` is
asked for and `kDRDeviceCanTestWriteCDKey` says no.

**ISRC is 12 bytes of `CFData` here**, not a string as on Windows. A code that
does not come to exactly 12 alphanumerics is dropped with a log line rather than
costing the disc.

**`kDRBurnCompletionActionKey` defaults to eject.** Leaving it out ejects after
every burn regardless of what the user chose, so it is always set explicitly.

**Pregap defaults to 150 blocks per track.** Without `kDRPreGapLengthKey` every
track gets the two-second gap — the default is the *gapped* disc, and gapless is
what needs saying. Track 1 keeps its mandatory 150, which is what `plan.rs`
already reserves.

## 7. Progress: polled, not observed

`macos.rs` polls `DRBurnCopyStatus` every 250 ms rather than registering with
`DRNotificationCenter`, mapping `kDRStatusStateKey` onto the existing
`BurnPhase` values and `kDRStatusPercentCompleteKey` onto the ring.

Polling avoids an observer callback and a run loop on the burn thread, and it
cannot reproduce the Windows failure where a stubbed `Invoke` swallowed every
tick while the burn ran fine: a poll loop that stops reporting has stopped
running, which is not a silent failure. The fill is held to a high-water mark so
the ring never runs backwards.

## 8. CD-TEXT read-back

`DiscRecording` has no public read-back call. `_DRDeviceReadCDText` is exported
but is private SPI and not in any header. `DRCDTextBlockCreateArrayFromPackList`
is public but needs raw packs from somewhere, and the `DKIOCCDREADTOC` ioctl its
documentation points at has no header in the macOS SDK.

So `verify_cd_text` runs `/usr/bin/drutil cdtext` — first-party, always present,
the same engine underneath — and parses it **one-sidedly**: it reports `found`
only on positively recognised CD-TEXT fields, and `unreadable` for everything
else, including output it does not understand. It will never report "the drive
wrote nothing" on the strength of a parse it could not validate against
hardware. That is the mistake §12 of the README records from Windows, and this
parse is precisely the kind that could repeat it.

Read-back is skipped when `eject_when_done` is set: the completion action has
already ejected the disc, so the check could only ever report "no disc" on a
disc that is perfectly good. There is **no user-facing command to re-check
afterwards** — `platform::verify_cd_text` is macOS-only and exists so the
runtime smoke test can reach `macos::verify_cd_text` through a private module.
Re-checking a disc by hand means reloading it and burning again, or reading it
with `drutil cdtext` directly.

## 9. What is free on macOS

- **No entitlement work.** `Entitlements.plist` disables the sandbox.
- **No exclusive-access dance.** The burn engine handles drive locking. A
  `DRDeviceAcquireMediaReservation` guard is taken so the Finder does not claim
  the blank disc mid-write, and released before the read-back.
- **No sector-format negotiation.** No cue sheet, no DATA FORM, no fallback
  ladder.

## 10. References

- `DiscRecording.framework/Headers/DRCore*.h` — the C API this is written
  against. In the SDK, not on the web; the Objective-C documentation online
  describes the wrapper, not this.
- [DiscRecording Release Notes](https://developer.apple.com/library/archive/releasenotes/MusicAudio/RN-DiscRecording/)
- `drutil(1)` — `cdtext`, `toc`, `subchannel` and `status` are all useful when
  diagnosing a drive.
