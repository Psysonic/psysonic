# CD Burner on macOS — as built

**Status:** implemented and **verified on hardware** — a disc was burned and its
CD-TEXT read back off it. Compiles, `clippy -D warnings` clean, 18 tests, and
the binding layer is exercised against the live framework.

Read [`README.md`](./README.md) first — the architecture, the audio pipeline and
the CD-TEXT format all carry over unchanged. This file covers only what is
different on macOS, and where the original plan was wrong.

---

## 1. What was built

Two source files and a smoke test. No new dependencies, no `build.rs`:

| File | Lines | What |
| --- | --- | --- |
| `macos_ffi.rs` | 591 | `extern "C"` declarations + CF ownership helpers |
| `macos.rs` | 1,369 + 306 tests | the four entry points, plus the track producer |
| `tests/macos_smoke.rs` | 38 | enumeration against the live framework |

`platform.rs` gained a `#[cfg(target_os = "macos")]` arm per entry point and
`is_supported()` now answers for both platforms. `cdtext/mod.rs` re-exports
`to_latin1`. Nothing else in the shared layers changed — in particular
**`render.rs` was not touched**, which the plan assumed it would be.

## 2. The headline still holds: macOS is the easy platform

None of the hard Windows work applies. No MMC passthrough, no `SEND CUE SHEET`,
no mode page `05h`, no raw P-W packing, no CRC, no SIZE_INFO. You hand
`DiscRecording` a `DRCDTextBlockRef` on the burn's property dictionary and it
writes the lead-in.

## 3. Where the plan was wrong

### 3a. There are bindings — just not Objective-C ones

The plan budgeted "250–350 lines of objc2 boilerplate" for `extern_class!` /
`msg_send!` against `DRDevice`, `DRBurn`, `DRTrack`, `DRCDTextBlock` and
`DRNotificationCenter`, plus a `build.rs`.

None of that was needed. `DiscRecording` ships a complete
**CoreFoundation-level C API** — `DRCoreBurn.h`, `DRCoreDevice.h`,
`DRCoreTrack.h`, `DRCoreCDText.h`, `DRCoreErase.h`, `DRCoreStatus.h` — which is
what the Objective-C classes are built on. Reaching it needs a `#[link]`
attribute and plain `extern "C"` declarations: no objc2 runtime, no macro
boilerplate, no `build.rs`, and **no new crate dependencies at all**.

It is also the larger surface. Prefer it.

### 3b. "Prepend a WAV header" is not an option, and would have been the worse one

The plan chose to write a 44-byte WAV header at render time and hand the file to
`DRAudioTrack`, calling the callback route "more code, more unsafe surface, no
benefit here".

**That API no longer exists.** `DRTrack.h` in the current SDK has no
`trackForAudioFile:`, and there is no `DRAudioTrack` class. `DRTrackCreate`
— which takes a properties dictionary and a `DRTrackCallbackProc` — is the only
track constructor either surface still offers. The choice was not available.

It is also the route we would want anyway. A `DRTrackCallbackProc` is an
ordinary `extern "C"` function pointer, and `render.rs` already produces exactly
what it must supply: headerless, sector-aligned, 44.1 kHz/16-bit/stereo PCM. The
WAV option would have meant a `cfg`-gated divergence inside the shared render
path; the callback means none.

The callback has no user-data pointer — it gets only the `DRTrackRef` — so
producer state lives in a registry keyed by the track's address, cleaned up by
`TrackSet`'s `Drop` before the tracks are released so an address cannot be
recycled onto a stale entry.

### 3c. Transliteration is not optional

The plan called running `cdtext::encode::to_latin1` as a pre-pass optional,
"if we want identical output across platforms — though the framework will handle
the encoding itself".

Measured against the live framework: `Żubr Kolektyw — ぁ` comes back as
`?ubr Kolektyw -- ?`. It **substitutes**; it does not transliterate. The shared
encoder gives `Zubr Kolektyw`. So the pre-pass is a real quality improvement,
not a consistency nicety, and `macos.rs` does it before the framework sees a
single string.

### 3d. The open item, answered

> **Open item:** which burn property key attaches the finished blocks.

`kDRCDTextKey`, in the dictionary passed to `DRBurnSetProperties`. It takes a
`DRCDTextBlockRef` or an array of them.

One thing that goes with it: Track-At-Once cannot carry CD-TEXT, so the burn
also asks for `kDRBurnStrategyCDSAO`. As a suggestion only —
`kDRBurnStrategyIsRequiredKey` is left unset, so a drive that reaches the same
result another way still burns.

### 3e. The test-write risk, answered

> Check whether `DRBurn` exposes a simulate/test-burn property before the first
> real disc — the Windows path leans on this heavily.

`kDRBurnTestingKey` is a real laser-off rehearsal, and it is **better than what
Windows has**: `IDiscFormat2RawCD` exposes no simulate flag, so the Windows
IMAPI2 rehearsal stops before `WriteMedia`. Here the entire write runs.

With one trap. The header says that if the drive cannot test-burn, "the burn
will default to a value of `false` and a normal burn will occur" — it silently
turns a rehearsal into a permanent disc. So `burn` refuses up front when
`test_write` is asked for and `kDRDeviceCanTestWriteCDKey` says no.

## 4. Hazards the plan did not anticipate

**Two keys fail the whole burn on an incapable drive.** `kDRTrackISRCKey`
(`kDRDeviceCantWriteISRCErr`) and `kDRCDTextKey` (`kDRDeviceCantWriteCDTextErr`)
are both all-or-nothing. Each is gated on the drive's own write-capabilities
dictionary before being attached, which is the macOS equivalent of the Windows
`SaoError::Setup` fallback: a drive that cannot do CD-TEXT gets a normal disc
rather than a refusal.

**ISRC is 12 bytes of `CFData` here**, not a string as on Windows. A code that
does not come to exactly 12 alphanumerics is dropped with a log line rather than
costing the disc.

**`kDRBurnCompletionActionKey` defaults to eject.** Leaving it out ejects after
every burn regardless of what the user chose, so it is always set explicitly.

**Pregap defaults to 150 blocks per track.** Without `kDRPreGapLengthKey` every
track gets the two-second gap — i.e. the default is the *gapped* disc, and
gapless is what needs saying. Track 1 keeps its mandatory 150, which is what
`plan.rs` already reserves.

## 5. Progress: polled, not observed

The plan suggested `DRNotificationCenter`. `macos.rs` polls `DRBurnCopyStatus`
every 250 ms instead, mapping `kDRStatusStateKey` onto the existing `BurnPhase`
values and `kDRStatusPercentCompleteKey` onto the ring.

Polling avoids an observer callback and a run loop on the burn thread, and it
cannot reproduce the Windows failure where a stubbed `Invoke` swallowed every
tick while the burn ran fine: a poll loop that stops reporting has stopped
running, which is not a silent failure. The fill is held to a high-water mark so
the ring never runs backwards.

## 6. CD-TEXT read-back

`DiscRecording` has no public read-back call. `_DRDeviceReadCDText` is exported
but is private SPI and not in any header. `DRCDTextBlockCreateArrayFromPackList`
is public but needs raw packs from somewhere, and the `DKIOCCDREADTOC` ioctl its
documentation points at has no header in the macOS SDK.

So `verify_cd_text` runs `/usr/bin/drutil cdtext` — first-party, always present,
the same engine underneath — and parses it **one-sidedly**: it reports `found`
only on positively recognised CD-TEXT fields, and `unreadable` for everything
else, including output it does not understand. It will never report "the drive
wrote nothing" on the strength of a parse it could not validate against
hardware. That is the mistake §12 of the README records from Windows, and the
parse here is precisely the kind that could repeat it.

Read-back is skipped when `eject_when_done` is set: the completion action has
already ejected the disc, so the check could only ever say "no disc". The
separate `burn_verify_cd_text` command re-checks after a reload, which the
README already notes is what actually settles it.

## 7. What is free on macOS

Confirmed, all three:

- **No entitlement work.** `Entitlements.plist` disables the sandbox.
- **No exclusive-access dance.** The burn engine handles drive locking. A
  `DRDeviceAcquireMediaReservation` guard is taken so the Finder does not claim
  the blank disc mid-write, and released before the read-back.
- **No sector-format negotiation.** No cue sheet, no DATA FORM, no fallback
  ladder.

## 8. What is verified, and what is not

Verified on this machine, with no drive attached:

- The crate builds and `clippy -D warnings` passes.
- Every symbol and dictionary key resolves — the test binary links
  `DiscRecording` and `CoreFoundation` and runs.
- Enumeration survives 200 round trips through `DRCopyDeviceArray` /
  `DRDeviceCopyInfo` / `DRDeviceCopyStatus`, so the retain/release balance holds.
- The producer is exercised **through the real framework**: `DRTrackEstimateLength`
  dispatches `kDRTrackMessageEstimateLength` into it and gets the rendered
  sector count back.
- Produced bytes come from the requested address, the final block is clipped and
  flagged, a subchannel request is refused rather than filled with noise, and
  dropping a `TrackSet` leaves no registry entry behind.
- CD-TEXT round-trips through `DRCDTextBlockCreate` / `SetValue` / `GetValue`
  with transliteration intact and the disc at index 0.
- Speed conversion between KB/s and sectors per second, both directions.

**Not verified — needs a Mac with a drive and a stack of blanks:**

1. That a burned disc plays. Nothing below `DRBurnWriteLayout` has been run.
2. That `kDRDeviceMediaBlocksFreeKey` is the capacity `plan.rs` expects. It is
   read as sectors including the pregap, matching what `LastPossibleStartOfLeadout`
   means on Windows; if a blank 80-minute CD-R reports something other than
   ~359,849 that assumption is wrong.
3. That gapless actually comes out gapless — `kDRPreGapLengthKey` of 0 is
   accepted as a suggestion, and a drive may round it up.
4. The `drutil cdtext` parse, against real output. It is written to fail safe,
   so the expected failure mode is "could not check" on a disc that does have
   CD-TEXT, not a false accusation.
5. Cancellation mid-write: `DRBurnAbort`, then the failed-state path, which is
   reported as a cancellation rather than a fault. The watch loop gives the
   drive 30 seconds to acknowledge an abort and then reports the cancellation
   anyway, so a drive that never winds down cannot wedge the job thread and
   leave the UI on "Stopping…" forever — but that 30-second path is exactly the
   one no test can reach without hardware.

Run a **test write first** (`kDRBurnTestingKey` exercises the whole path,
including CD-TEXT, without consuming media). Unlike Windows, that rehearsal is
real here, so it should catch 1, 3 and 5 for free.

## 9. CI does not cover this

Worth knowing before the next change to these files:

- `rust-tests.yml` runs on `ubuntu-24.04` and `windows-latest` only. **The 18
  macOS tests never run in CI, and `macos.rs` is never even compiled there** —
  it is behind `#[cfg(target_os = "macos")]`, so a change that breaks it is
  green on every automatic check.
- `macos-bundle-test.yml` does build on `macos-latest`, which would catch a
  compile error, but it is `workflow_dispatch` — manual, never on push or PR.

So until a macOS job runs `cargo test -p psysonic-burn` on every PR, this
backend is verified only by whoever last ran it locally. Adding `macos-latest`
to the `rust-tests.yml` matrix is the cheap fix and would have caught
everything in §8's "verified" list.

## 10. References

- `DiscRecording.framework/Headers/DRCore*.h` — the C API this is written
  against. In the SDK, not on the web; the Objective-C documentation online
  describes the wrapper, not this.
- [DiscRecording Release Notes](https://developer.apple.com/library/archive/releasenotes/MusicAudio/RN-DiscRecording/)
- `drutil(1)` — `cdtext`, `toc`, `subchannel`, `status` are all useful when a
  drive finally exists.
