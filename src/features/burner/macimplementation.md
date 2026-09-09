# CD Burner on macOS — implementation notes

**Status:** not implemented. This is the research and plan, written after the
Windows path (IMAPI2 + hand-rolled Session-At-Once for CD-TEXT) shipped and was
verified on hardware, so it says what is genuinely left rather than restating
the whole design.

Read [`README.md`](./README.md) first — the architecture, the audio pipeline and
the CD-TEXT format all carry over unchanged. This file only covers what is
different on macOS.

---

## 1. The headline: macOS is the easy platform

`DiscRecording.framework` has **native CD-TEXT support**. None of the hard
Windows work applies:

| Windows needs | macOS needs |
| --- | --- |
| `IDiscRecorder2Ex::SendCommand*` MMC passthrough | — |
| `SEND CUE SHEET` (`5Dh`) construction | — |
| Write Parameters mode page `05h` | — |
| Raw P-W subchannel packing, CRC, SIZE_INFO | — |
| A capability probe to find out if CD-TEXT is even possible | — |
| A `Setup`/`Write` error split so a refusal can fall back | — |

On macOS you hand the framework strings and it writes the lead-in.

## 2. What already exists and carries over

Measured against the current tree:

| Reusable unchanged | Lines |
| --- | --- |
| `model.rs` — DTOs, Red Book constants | 292 |
| `plan.rs` — disc layout and capacity | 201 |
| `render.rs` — decode → 44.1 kHz/16-bit/stereo | 564 |
| `fetch.rs` — pulling source audio down | 388 |
| `job.rs` — cancel registry, `burn:*` events | 128 |
| `commands.rs` — the Tauri surface and orchestrator | 372 |
| The entire frontend | — |

| Windows-only, **not needed** on macOS | Lines |
| --- | --- |
| `cdtext/` — the framework encodes for us | ~990 |
| `mmc/` | ~670 |
| `win.rs`, `win_sao.rs` | ~1,580 |

So the work is **one new file**, `macos.rs`, implementing the four entry points
`platform.rs` already dispatches to:

```rust
list_recorders() -> Result<Vec<BurnRecorder>, String>
probe_media(recorder_id) -> Result<BurnMediaInfo, String>
burn(app, job_id, tracks, options, cancel) -> Result<BurnOutcome, String>
erase(recorder_id, quick) -> Result<(), String>
```

`platform.rs` already has the `#[cfg]` arms; they currently return
`UNSUPPORTED`. Nothing above `platform.rs` changes.

## 3. The one real obstacle: no bindings exist

**There is no `objc2-disc-recording` crate.** Checked against the objc2
generated-framework list: no `Disc*` framework appears in the supported set, and
DiscRecording / DiscRecordingUI sit in the *unsupported* section annotated
"Deprecated, use AVKit/AVFoundation instead" — which is wrong on its face
(AVFoundation cannot burn discs), but the practical consequence stands.

So the bindings are hand-written with `objc2`:

- `extern_class!` / `msg_send!` for `DRDevice`, `DRBurn`, `DRTrack`,
  `DRCDTextBlock`, `DRNotificationCenter`
- `-framework DiscRecording` from a `build.rs`
- `objc2-foundation` for `NSString`, `NSArray`, `NSDictionary`, `NSNumber`

Budget roughly **250–350 lines of binding boilerplate** before any burner logic.

### Is the framework still viable?

Yes, despite the deprecation note. Apple Music still burns audio CDs on current
macOS, and Burn.app ships as a Universal binary running natively on Apple
Silicon. Adobe dropped CD burning on ARM in Audition, but that is a product
decision, not a platform limitation.

Treat it as *deprecated but present*: fine to build on, worth a runtime check
that the framework loaded rather than assuming.

## 4. The CD-TEXT API (verified against the SDK header)

`DRCDText.h` maps directly onto the existing `CdTextInput` model — same shape,
track 0 for the disc and 1..n for tracks:

```objc
+ (DRCDTextBlock*) cdTextBlockWithLanguage:(NSString*)lang
                                  encoding:(NSStringEncoding)enc;

- (void) setObject:(id)value forKey:(NSString*)key ofTrack:(NSUInteger)trackIndex;
```

- **Language**: ISO-639 code, or an empty string for unknown.
- **Encoding**: `DRCDTextEncodingISOLatin1Modified` or `DRCDTextEncodingASCII`.
  Latin-1 matches what the Windows encoder already targets, so the
  transliteration rules in `cdtext::encode::to_latin1` stay meaningful as a
  pre-pass if we want identical output across platforms — though the framework
  will handle the encoding itself.
- **Track index**: `0` = disc-level, `1+` = per track. Identical semantics to
  our own encoder, including the trap that the disc-level slot must exist even
  when empty or every track's value shifts by one.
- **Keys**: `DRCDTextTitleKey`, `DRCDTextPerformerKey` (also `Composer`,
  `Songwriter`, `Arranger`, `SpecialMessage`).

**Open item:** which burn property key attaches the finished blocks. The
`DRCDText.h` excerpt does not say; check `DRBurn.h` for the CD-TEXT key in the
burn properties dictionary before writing the burn call.

## 5. Two design decisions to make

### Feeding the audio

`DRAudioTrack` wants an audio *file*; `render.rs` produces headerless CD-format
PCM. Two options:

1. **Prepend a 44-byte WAV header at render time on macOS.** The PCM is already
   44 100 Hz / 16-bit / stereo, so nothing is re-encoded — it is a header write
   and a rename. Cheapest by a distance.
2. Implement `DRTrackDataProduction` callbacks and feed sectors on demand. More
   code, more unsafe surface, no benefit here.

Take option 1. Gate it on `cfg(target_os = "macos")` inside `render.rs` so the
Windows path keeps handing raw sectors straight to IMAPI2.

### Progress

`DRNotificationCenter` posts burn progress notifications. Map those onto the
existing `burn:progress` event with the same phases.

Worth noting: this is a documented, ordinary notification API — not a COM
dispinterface — so it should not repeat the Windows failure where a stubbed
`Invoke` silently swallowed every tick. Still add the same one-line-per-burn
diagnostic on the paths that can go quiet.

## 6. What is free on macOS

- **No entitlement work.** `src-tauri/Entitlements.plist` disables the sandbox
  (`com.apple.security.app-sandbox` = `false`), so there is no
  `com.apple.security.device.*` question to answer.
- **No exclusive-access dance.** macOS handles drive locking; there is no
  equivalent of `IDiscRecorder2::AcquireExclusiveAccess` / `PrepareMedia`
  pairing to get right, and no drop guard needed to avoid leaving a drive
  locked until the process exits.
- **No sector-format negotiation.** No cue sheet, so no DATA FORM, no
  per-drive fallback ladder.

## 7. Task breakdown

| Task | Estimate |
| --- | --- |
| `build.rs` link flag + `objc2` bindings for the five classes | 1–2 days |
| `list_recorders` + `probe_media` (media type, blank, capacity, speeds) | 1 day |
| `burn` — tracks, burn object, progress notifications | 1–2 days |
| CD-TEXT blocks + `erase` + error mapping | 1 day |

**4–6 days total**, revised down from the 1–1.5 weeks in the README now that
every shared layer exists.

## 8. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Cannot be compiled or run from a Windows dev machine | High | It will land untested against hardware, exactly as the Windows path did. Needs a Mac with a USB drive to shake out. |
| Framework deprecated; could be removed in a future macOS | Medium | Check at runtime that the framework loaded and report honestly rather than crashing. The feature degrades to "not supported here". |
| Hand-written `msg_send!` bindings are unchecked by the compiler | Medium | Keep the binding layer thin and mechanical; put every decision in the shared Rust above it, which is already tested. |
| No test-write equivalent confirmed | Medium | Check whether `DRBurn` exposes a simulate/test-burn property (`DRBurnTestingKey` or similar) before the first real disc — the Windows path leans on this heavily. |

## 9. Sequencing

The Windows CD-TEXT burn is now verified by read-back on real hardware, so the
shared model is settled and this is safe to start. One thing that verification
changed and macOS should inherit: **read the result back rather than trusting
the framework**, and report "could not check" separately from "nothing there".

## 10. References

- [DRCDText.h](https://github.com/phracker/MacOSX-SDKs/blob/master/MacOSX10.9.sdk/System/Library/Frameworks/DiscRecording.framework/Versions/A/Headers/DRBurn.h) —
  SDK headers (the repo also carries `DRBurn.h`, `DRTrack.h`, `DRDevice.h`)
- [DiscRecording Release Notes](https://developer.apple.com/library/archive/releasenotes/MusicAudio/RN-DiscRecording/)
- [objc2 generated-framework list](https://docs.rs/objc2/latest/objc2/topics/about_generated/list/index.html) —
  confirms DiscRecording is absent
- [objc2](https://github.com/madsmtm/objc2) — `extern_class!` / `msg_send!` usage
