# CD Burner — design document

**Status:** shipping on Windows, verified on hardware — audio, gapless
Disc-At-Once, and **CD-TEXT confirmed by reading it back off a burned disc**.
macOS is implemented but has never met a drive; see
[`macimplementation.md`](./macimplementation.md) for what is verified and what
is still waiting on hardware. Linux is not implemented.

**Scope:** burn a Red Book audio CD-R from library tracks, with CD-TEXT readable
by players that support it.

Tracks that are not already cached offline are **downloaded by the burn itself**
as its first step — no manual "make available offline" detour.

---

## Contents

- [1. Why this lives in-tree](#1-why-this-lives-in-tree)
- [2. What already exists that we reuse](#2-what-already-exists-that-we-reuse)
- [3. The CD-TEXT problem](#3-the-cd-text-problem)
- [4. Phased plan](#4-phased-plan)
- [5. Architecture](#5-architecture)
- [6. Audio pipeline spec](#6-audio-pipeline-spec)
- [7. Windows burn path](#7-windows-burn-path)
- [8. CD-TEXT encoding](#8-cd-text-encoding)
- [9. Linux and macOS](#9-linux-and-macos)
- [10. UI — the disc ring](#10-ui--the-disc-ring)
- [11. Risks](#11-risks)
- [12. Estimates](#12-estimates)
- [13. References](#13-references)

---

## 1. Why this lives in-tree

Psysonic has no plugin system. The only user-extensibility point is the theme
store (`src-tauri/src/theme_import.rs`), which accepts a `.zip` of
`manifest.json` + `theme.css` + whitelisted assets. It is declarative CSS only —
no code execution, no feature hooks.

Every backend capability is compiled in and registered through
`collect_commands!` in `src-tauri/src/lib.rs`. A burner is therefore a normal
in-tree feature: a Rust crate plus `src/features/burner/`, subject to the usual
gates (specta bindings, dependency-cruiser layering, `clippy -D warnings`,
coverage hot-path floors, i18n keys in `src/locales/en.ts`).

## 2. What already exists that we reuse

| Asset | Location | Use |
| --- | --- | --- |
| `windows` crate 0.62 | `src-tauri/Cargo.toml` | IMAPI2 is at `windows::Win32::Storage::Imapi`. Add the `Win32_Storage_Imapi` feature; no new dependency. |
| Win32 COM precedent | `src-tauri/src/taskbar_win.rs` | `ITaskbarList3` + `CoInitializeEx` already shipped. Establishes the pattern for COM lifetime, apartment threading and pointer handling in this codebase. |
| Symphonia decode session | `psysonic-analysis/src/analysis_cache/compute/decoder.rs` | `open_decode_session` handles every format the player supports. We add a stereo-interleaved sink beside the existing mono one (`decode_mono_pcm_limited`). |
| Local file cache | `psysonic-syncfs` | A cache hit means the burn downloads nothing for that track. |
| Download transport | `psysonic-syncfs::file_transfer` | `subsonic_http_client` + `apply_server_http_get` (per-server headers/certs) + `finalize_streamed_download` (`.part` + atomic rename) are already `pub`. The fetch step composes them; syncfs needed no changes. |
| Job pipeline | `src/features/deviceSync/**` | Progress + cancel + finalize + error-toast flow over Tauri events. The burn job copies this shape exactly. |
| `ebur128` | `src-tauri/Cargo.toml` | Optional per-disc loudness normalisation across tracks from different albums. |
| Design tokens | `src/styles/themes/` | `--accent`, `--bg-card`, `--text-*`, `--space-*`, `--radius-*`, `--shadow-*`. Building from tokens means every community theme restyles the burner for free. |

## 3. Why CD-TEXT needs its own write path

IMAPI2 is the sanctioned Windows burning API. It works without elevation, which
matters because our NSIS bundle uses `installMode: "currentUser"`.

**IMAPI2 cannot write CD-TEXT.** Verified against the interface definitions:

- `IRawCDImageCreator` — Disc-At-Once, `put_DisableGaplessAudio`, MCN,
  `get_StartOfLeadout` for capacity validation. No CD-TEXT member.
- `IRawCDImageTrackInfo` — per-track ISRC, pre-emphasis, digital-copy bit.
  No CD-TEXT member.
- `IDiscFormat2TrackAtOnce` — TAO with mandatory 2-second gaps. Worse.

`IRawCDImageCreator::AddSubcodeRWGenerator` looks promising and is not. It writes
R-W subcode in the **program area** (CD+G graphics). CD-TEXT lives in the
**lead-in**.

**The escape hatch:** `IDiscRecorder2Ex` exposes `SendCommandNoData`,
`SendCommandSendDataToDevice`, `SendCommandGetDataFromDevice` and `SetModePage`
— raw MMC passthrough *routed through IMAPI2*. That gives device access and
`AcquireExclusiveAccess` **without elevation and without SPTI handle wrangling**,
and is what `win_sao.rs` uses.

## 4. Two write paths

**IMAPI2 (`win.rs`) — the default and the fallback.**
`IRawCDImageCreator` + `IDiscFormat2RawCD`. Gapless DAO, ISRC, MCN, capacity
validation. Works on every Windows machine, unelevated. No CD-TEXT.

**Session-At-Once (`win_sao.rs`) — when CD-TEXT is asked for.**
Hand-rolled MMC, gated on the drive's own capability report. It replaces
IMAPI2's `WriteMedia` entirely, so the split in `SaoError` is the safety
property that matters:

- `Setup` — the drive refused the mode page or the cue sheet. Nothing has
  touched the disc, so the caller falls back to IMAPI2 and burns without
  CD-TEXT. The user still gets a disc.
- `Write` — the laser was already on. The disc is spoiled and the error
  propagates; no retry is attempted onto it.

So the worst realistic outcome of a drive quirk is a normal disc without
CD-TEXT, not a coaster.

## 5. Architecture

### Rust

New workspace crate `src-tauri/crates/psysonic-burn/`:

```
src/
  lib.rs           — public surface
  model.rs         — Red Book constants + IPC DTOs
  fetch.rs         — pull source audio down when it is not cached (pure planning)
  plan.rs          — disc layout and capacity arithmetic (pure)
  render.rs        — decode -> 44.1k/16-bit/stereo -> sector-aligned PCM (pure)
  job.rs           — cancel registry + the two Tauri events
  platform.rs      — dispatch to the per-OS backend
  win.rs           — IMAPI2: image creator, format2rawcd, capability probe
  commands.rs      — the Tauri surface + the burn orchestrator
  cdtext/          — pack encoder (pure, heavily tested)
  mmc/             — cue sheet, mode page 05h, CDBs (pure, heavily tested)
  win_sao.rs       — the Session-At-Once write that carries CD-TEXT
```

`plan.rs` and `render.rs` are pure and platform-independent — that is where the
unit tests live, and it keeps the untestable hardware layer thin. The layout is
flatter than originally sketched because `render` and `plan` each stayed small
enough to read in one file; split them when a second backend needs to share
pieces.

### Command surface

Additive only, per the Rust ↔ frontend contract in `CONTRIBUTING.md`:

```
burn_list_recorders()          -> Vec<BurnRecorder>
burn_probe_media(recorder_id)  -> BurnMediaInfo   // blank? capacity, speeds, CD-TEXT capable?
burn_render_preview(list)      -> BurnPlan        // sector counts, total time, warnings
burn_start(list, options)      -> BurnJobId
burn_cancel(job_id)            -> ()
burn_erase(recorder_id, quick) -> BurnJobId       // CD-RW
```

### Events

Mirroring `device:sync:*`:

```
burn:progress   { jobId, phase, trackIndex, sectorsWritten, sectorsTotal, bufferLevel }
burn:complete   { jobId, cancelled, failed, message }
```

`phase` is one of `fetching | analyzing | rendering | preparing | writing | closing`.
The UI needs the phase distinction because the ring animates differently for
each — see section 10.

### Frontend

```
src/features/burner/
  README.md              — this file
  index.ts               — barrel (cross-feature access goes only through here)
  pages/Burner.tsx       — lazy route at /burn, mirroring AppRoutes.tsx:124
  components/
    DiscRing.tsx         — the centrepiece, see section 10
    BurnTrackList.tsx
    CdTextFields.tsx
    RecorderPicker.tsx
    BurnOptionsDrawer.tsx
  hooks/useBurnJobEvents.ts
  store/burnListStore.ts
  store/burnJobStore.ts
  utils/capacity.ts      — sector/time math, pure, unit-tested
```

Layering: `features/burner` may import `lib`, `store`, `ui`, `cover`,
`music-network` and other feature barrels. Nothing lower may import it.

## 6. Audio pipeline spec

Target: **44 100 Hz, 16-bit signed little-endian, stereo interleaved**.

| Constant | Value |
| --- | --- |
| Sectors per second | 75 |
| Bytes per audio sector | 2352 |
| Bytes per sector with raw P-W subchannel | 2448 |
| Samples per sector (stereo frames) | 588 |
| Track-1 pregap | 150 sectors (2 s) |
| 74-min disc capacity | 333 000 sectors |
| 80-min disc capacity | ~359 849 sectors |
| Full 80-min raw image on disk | ~846 MB |

Rules:

- **Track boundaries must land on a 588-sample frame.** Pad the tail with
  silence to the next sector; anything else clicks.
- **Resampling.** rodio's resampler is linear interpolation. Acceptable for a
  crossfade blend, *not* for a 48 kHz -> 44.1 kHz master. Add `rubato` (MIT) and
  use a sinc resampler. Only resample when the source rate differs.
- **Dither.** TPDF dither on the f32 -> i16 conversion. Truncation is audible on
  quiet passages.
- **Normalisation (optional, off by default).** Reuse `ebur128` to measure each
  track, then bring **each one** to a shared target (-14 LUFS). This is
  per-track gain, not one disc-wide gain: the point of the feature is a
  compilation drawn from different albums that plays evenly, and a single
  shared gain would preserve exactly the album-to-album loudness gaps the user
  wants gone. Never allow clipping — the gain is capped against each track's
  measured peak, so a track already at full scale is left alone rather than
  driven into the limiter.
- **Capacity check happens on the rendered sector count**, not on estimated
  duration. Round-off across 20 tracks is enough to overrun a disc.

## 6a. Fetching source audio

The burn never required a manual download step to be *correct* — it required it
because the first cut had no fetch path. It does now, and three decisions shape
it:

**Fetched bytes go in the job's own workdir, never the offline library.** A full
disc is up to ~800 MB of source audio. Routing that through the shared media
tiers would grow the user's offline storage against their configured limit and
could evict tracks they pinned deliberately. Burning a CD must not cost you your
offline library. The workdir is already wiped when the job ends, so the copies
go with it.

**Originals only — `download.view`, never `stream.view`.** Psysonic has a
per-address transcode cap, so the stream endpoint can hand back a lossy
re-encode. Burning that to a CD-R is a silent, permanent quality loss on media
that cannot be rewritten.

**One track at a time: fetch → measure → render → delete the source.** Peak disk
is then a single source file plus the accumulating PCM (~900 MB), instead of the
whole download set plus the PCM (~1.6 GB). This works because normalisation gain
is computed against a fixed target rather than against the other tracks, so no
track needs to know about any other. `fetch::check_free_space` refuses the job
up front rather than failing at sector 200 000.

A track whose `source_path` still resolves to a readable file is used as-is and
downloads nothing — but the path is re-checked at burn time, because the offline
cache can evict a file between queueing and burning.

## 7. Windows burn path

### The IMAPI2 path (`win.rs`)

**The order below is load-bearing.** `IDiscFormat2RawCD` — unlike
`IDiscFormat2Data`, which prepares internally — needs an explicit
`PrepareMedia()` before *any* media-dependent property. Touching
`SupportedSectorTypes`, `RequestedSectorType` or `LastPossibleStartOfLeadout`
first fails with `IMAPI_E_NOT_PREPARED` (`0xC0AA0602`), because none of those
questions have an answer until the drive has spun up and read the disc.

1. `CoCreateInstance(MsftDiscMaster2)` -> enumerate -> `IDiscRecorder2`.
2. `MsftDiscFormat2RawCD` -> `SetRecorder`, `SetClientName`, `SetWriteSpeed`.
3. `IDiscRecorder2::AcquireExclusiveAccess`.
4. **`PrepareMedia()`** — paired with `ReleaseMedia()` by a drop guard, because
   media left prepared keeps the drive locked until the process exits.
5. `SupportedSectorTypes` -> pick a layout the drive actually offers, widest
   subcode first (cooked R-W, then raw P-W, then P-Q). One answer feeds both
   `SetRequestedSectorType` and the image creator's `SetResultingImageType` —
   the writer and the image must agree or the burn is garbage.
6. `MsftRawCDImageCreator` -> `SetDisableGaplessAudio(VARIANT_FALSE)`,
   `AddTrack(IMAPI_CD_SECTOR_AUDIO, stream)` per track, per-track ISRC, MCN.
7. `LastPossibleStartOfLeadout` vs the rendered sector count -> reject early
   with a real message.
8. `CreateResultImage` -> `IDiscFormat2RawCD::WriteMedia`.
9. Progress via `DDiscFormat2RawCDEvents`, bridged to `burn:progress`.

**The event sink has two traps, both found on real hardware:**

- Declare it `#[implement(DDiscFormat2RawCDEvents)]` and nothing else.
  That dispinterface already derives from `IDispatch`, and listing `IDispatch`
  alongside it makes `windows-implement` emit a *second*, standalone vtable —
  so `QueryInterface(IID_IDispatch)` returns an object whose `Invoke` is not
  the one wired to the events.
- Implement `Invoke`, don't stub it. IMAPI2 may drive the sink through the
  vtable *or* through late binding depending on how its connection point
  resolved us; a stubbed `Invoke` swallows every tick. The arguments arrive in
  `DISPPARAMS` in **reverse** declaration order, so `progress` is `rgvarg[0]`.

Both failures look identical from the UI — the burn runs correctly and the
progress bar sits at 0% — so every silent path in the sink now logs its reason
once per burn.

**Image streaming.** `AddTrack` takes an `IStream`. Two options:

- *Simple:* render each track to a temp file, wrap with
  `SHCreateStreamOnFileEx`. Costs up to ~846 MB of temp space for a full disc.
- *Better:* implement `IStream` in Rust via `windows-implement` and generate
  sectors on demand from the decoder.

Start with the temp file. Check free space before rendering and surface a clear
error if there isn't room; do not fail at sector 200 000.

### The CD-TEXT path (`win_sao.rs`)

Same enumeration and exclusive access, then drive the write ourselves:

1. `GET CONFIGURATION` -> confirm the drive advertises SAO cue-sheet writing.
2. `SetModePage` / `MODE SELECT` page `0x05`: write type SAO, Data Block Type 3.
3. `SendCommandSendDataToDevice` with `SEND CUE SHEET` (`0x5D`).
4. `SendCommandSendDataToDevice` with `WRITE(10)` (`0x2A`) at negative LBAs for
   the CD-TEXT lead-in.
5. `WRITE(10)` the program area in 2448-byte blocks.
6. `CLOSE TRACK/SESSION`.

**Use the Test Write bit in mode page `0x05` during development.** It exercises
the whole path without consuming media. This will save a great many discs.

Two different "test writes" exist, and the difference matters:

- **IMAPI2 path** — `IDiscFormat2RawCD` exposes no simulate flag, so the
  rehearsal runs everything up to `WriteMedia` and stops. It proves the drive
  and disc are usable; it does not exercise the write.
- **CD-TEXT path** — mode page `05h` bit 4 is a real laser-off test write, so
  the rehearsal runs the *entire* sequence including every `WRITE(10)`. If a
  drive is going to reject our cue sheet or lead-in, this finds out for free.

**Expect per-drive quirks.** cdrdao carries a `variant` fallback loop precisely
because drives disagree about cue-sheet and data-block-type acceptance. Budget
for a small fallback ladder rather than assuming one code path works everywhere.

## 8. CD-TEXT encoding

**Status: built and verified** (`src/cdtext/`, 31 tests). The *encoder* is done;
the device-side write that carries it to the lead-in is not — see section 8a.

Pure Rust in `cdtext/`, no platform code, fully unit-testable against known-good
byte vectors.

- Packs are **18 bytes**: 4 header (pack type, track number, sequence,
  block/character position) + 12 data + 2 CRC.
- CRC is **CRC-16-CCITT** (polynomial `0x1021`), stored inverted.
- Pack types used: `0x80` TITLE, `0x81` PERFORMER, `0x82` SONGWRITER,
  `0x83` COMPOSER, `0x84` ARRANGER, `0x85` MESSAGE, `0x86` DISC_ID,
  `0x87` GENRE, `0x8E` UPC/EAN + ISRC, `0x8F` SIZE_INFO.
- Pack `0x00` of each type carries the **disc-level** value; packs `0x01..n`
  carry per-track values.
- `0x8F` SIZE_INFO must be generated last — it describes the block.
- Up to 8 language blocks. Ship one (the user's library language) initially.
- Character set: default to ISO-8859-1. Anything outside it must be
  transliterated or rejected with a visible warning — silently mangling a track
  title on the disc is worse than telling the user.

Layout was verified against the libcdio CD-TEXT format reference before being
trusted, and the SIZE_INFO offsets below are the confirmed ones:

| Offset | Field |
| --- | --- |
| 0 | Character code (`0x00` ISO-8859-1) |
| 1 | First track |
| 2 | Last track |
| 3 | Copyright (`0x00` none, `0x03` copyrighted) |
| 4–19 | Pack count per type `0x80`–`0x8F` |
| 20–27 | Highest sequence number, blocks 0–7 |
| 28–35 | Language code, blocks 0–7 (English = `0x09`) |

Header byte 3 is bit 7 = double-byte characters, bits 6–4 = block number,
bits 3–0 = character position (how much of the current item already went out,
capped at 15). The CRC is CRC-16-CCITT over the first 16 bytes, **inverted**,
big-endian — an un-inverted CRC is accepted by some players and silently
ignored by others, which is worse than failing.

Non-Latin-1 text is transliterated rather than dropped or mangled: a player
showing `Zubr Kolektyw` is a small lie; a mojibake title burned onto a disc that
cannot be rewritten is a worse one.

## 8a. Carrying CD-TEXT to the lead-in

The encoder produces the packs and maps them onto raw R-W subchannel bytes
(4 packs = 72 bytes = 96 six-bit symbols = exactly one sector, no interleaving,
no parity beyond each pack's CRC). What is missing is the write itself:

1. `MODE SELECT` page `0x05`: write type SAO, Data Block Type 3 (2448-byte
   blocks), via `IDiscRecorder2Ex::SetModePage`.
2. `SEND CUE SHEET` (`0x5D`) describing the TOC.
3. `WRITE(10)` (`0x2A`) at negative LBAs from `-150 - leadInLen` for the
   CD-TEXT lead-in, then the program area.
4. `CLOSE TRACK/SESSION`.

Both questions this section once listed as open are now answered from the
specification rather than assumed:

- **P and Q are the drive's job.** §6.2.11.3: *"The P and Q sub-channel
  information contained within the Subcode Data shall be ignored. The P and Q
  sub-channel information is generated by the drive and based on the content of
  the cue sheet."* The encoder leaves those bits clear, which is correct.
- **The lead-in length is ours, not the drive's** — `-150 - ceil(packs / 4)`,
  derived from the pack count.

The DATA FORM byte (Tables 160 and 163) is the pivot: bits 7-6 select the
sub-channel form (`01` = RAW, 96 bytes from the host), bits 3-0 the main-data
form (`0` = host sends 2352, `1` = the drive generates the frame). So the
CD-TEXT lead-in entry is **`41h`** — drive-generated main channel, host-supplied
raw P-W — and the program area stays `00h`.

**This replaces IMAPI2's `WriteMedia`, which is the risk**, so the split in
`SaoError` is the safety property that matters:

- `Setup` — the drive refused the mode page or the cue sheet. Nothing has
  touched the disc, so the caller falls back to the IMAPI2 path and burns
  without CD-TEXT.
- `Write` — the laser was already on. The disc is spoiled and the error
  propagates; no retry is attempted onto it.

Two further defences, because inter-drive variance in SAO writing is the
best-documented pain point in CD burning:

1. **Capability gate.** MMC feature 002Eh (`GetFeaturePage`) reports
   `SessionAtOnce` and `RWSubchannelsRecordable`; drives that say no never see
   the option, so they cannot fail.
2. **Read-back verification.** After the burn, `READ TOC/PMA/ATIP` format
   `0101b` returns the CD-TEXT actually stored in the lead-in, and only packs
   with a valid CRC are counted. A drive that claims the capability and writes
   nothing is caught by its own disc and reported, rather than leaving the user
   to wonder why their player is blank.

`sp00nznet/futureburn` (MIT, C#) has a CD-TEXT encoder its author describes as
complete and correct. It is a licence-compatible reference to port from. cdrdao
is a good protocol reference but check its headers before copying any code —
GPL-2.0-*only* code cannot be merged into this GPL-3.0-or-later tree.

## 9. Linux and macOS

**Linux.** `SG_IO` ioctl passthrough, same MMC sequence as `win_sao.rs`. Requires the
user to be in the `cdrom` group or have an appropriate udev rule — detect and
explain rather than failing opaquely. Shelling out to `cdrdao` is a reasonable
fallback since most distros package it.

**macOS.** Implemented in `macos.rs` / `macos_ffi.rs`.
`DiscRecording.framework` supports CD-TEXT natively via `DRCDTextBlock` — the
only platform where it is first-class — so none of §7's MMC work applies. The
bindings are hand-written, but against the framework's CoreFoundation-level
`DRCore*` C API rather than `objc2`: plain `extern "C"`, no new dependencies,
no `build.rs`. Tracks are fed by a `DRTrackCallbackProc` producer, which takes
the sector-aligned PCM `render.rs` already writes, unchanged. Details and the
open hardware questions are in
[`macimplementation.md`](./macimplementation.md).

**Do not bundle cdrtools/cdrecord.** It is CDDL; combining it with a GPLv3 tree
is a real distribution problem and the reason Debian forked cdrkit. cdrdao is
licence-workable as a separate process, but its Windows binaries are ASPI-era
and effectively unmaintained — not something to ship in an app that builds its
own audio stack.

## 10. UI — the disc ring

The centrepiece is an actual disc: a circular capacity ring where each track is
an arc segment, sized by duration and coloured from its album art.

- **Geometry.** Full circle = the media capacity (74 or 80 min, from the probed
  disc). Arcs laid clockwise from 12 o'clock. Unused capacity is a dim track.
- **Limit marks.** 74:00 and the 79:57 hard limit drawn as boundary ticks. Going
  past turns the overflowing arc `--danger` and disables Burn.
- **Hub.** Remaining time, track count, and the disc title. On hover of an arc,
  the hub swaps to that track's title/artist/duration.
- **Interaction.** Drag arcs around the circumference to reorder — the ordering
  is the disc's running order, so making that physical is the whole point.
  Hovering an arc lifts the corresponding row in the track list, and vice versa.
- **Burn progress.** The same ring becomes the progress indicator: arcs light up
  clockwise as sectors are written. The visualisation *is* the progress bar.
  Lead-in (CD-TEXT) writes as a short pulse inside the inner radius before the
  first arc lights.
- **CD-TEXT.** Title/performer editable inline per track; disc-level
  title/performer/UPC above the ring. When the probed drive can't write CD-TEXT,
  the fields stay visible but the toggle is disabled with a tooltip explaining
  why — the user should learn it's their drive, not the app.

Built entirely from existing CSS custom properties so community themes apply
without extra work.

Route at `/burn`, lazy-loaded, mirroring `src/app/AppRoutes.tsx:124`. Entry
points: sidebar item, plus "Add to CD" in the existing context menu for albums,
tracks and playlists.

## 11. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Drive doesn't support SAO CD-TEXT | High | Feature 002Eh probe gates the toggle; a `Setup` refusal falls back to IMAPI2; read-back reports the truth. |
| CD-TEXT writes but reads back empty | Medium | Read-back verification catches it and says so. Seen and fixed once: the lead-in must be filled end to end, not just once. |
| Per-drive cue-sheet incompatibility | Medium | Small fallback ladder of mode-page/cue-sheet variants. |
| Temp space for the raw image | Medium | Pre-flight free-space check; or implement streaming `IStream`. |
| Buffer underrun on slow sources | Medium | Render fully to disk before writing. Never decode inside the write loop. |
| Resample quality regressions | Low | `rubato` sinc; snapshot tests on a known sine sweep. |
| No hardware simulator | Medium | MMC Test Write bit; IMAPI2 simulation option. |
| Progress reporting silently dead | Low | Every early return in the sink logs once per burn. The burn itself never depends on the sink. |

## 12. What this cost, and the lesson

Windows, complete and hardware-verified. The estimates in the original plan were
roughly right for the parts that were understood; the CD-TEXT write was not.

**Three burns were wasted getting the lead-in right, all from the same root
cause:** the implementation was derived from ANSI X3.304-1997, which is **MMC-1
and contains no mention of CD-TEXT at all**. Its Table 155 note 5 even states
that *"All data for both lead-in and lead-out shall be generated by the drive"* —
so the document being used as the authority describes a world in which the
feature being built cannot exist.

The wrong turns, in order:

1. Wrote a lead-in only as long as the packs (9 sectors). The lead-in is the
   *whole* lead-in — ~13 500 sectors — with the packs repeated to fill it.
2. Diagnosed that as the wrong sub-channel form and switched `41h` → `C1h`,
   breaking the encoding too. `41h` had been right all along.
3. Conflated "the drive refused the read-back query" with "the disc has no
   CD-TEXT", so the first failure reported the wrong cause.

What resolved it was reading `GenericMMC.cc` from cdrdao — a working
implementation — rather than reasoning further from a specification. **For a
feature this narrow and this destructive to get wrong, check a working
implementation first and use the spec to understand it, not the other way
round.**

## 13. References

- [IRawCDImageCreator](https://learn.microsoft.com/en-us/windows/win32/api/imapi2/nn-imapi2-irawcdimagecreator)
- [IRawCDImageTrackInfo](https://learn.microsoft.com/en-us/windows/win32/api/imapi2/nn-imapi2-irawcdimagetrackinfo)
- [IDiscRecorder2Ex](https://learn.microsoft.com/en-us/windows/win32/api/imapi2/nn-imapi2-idiscrecorder2ex) — the MMC passthrough escape hatch
- [IDiscFormat2RawCD](https://learn.microsoft.com/en-us/windows/win32/api/imapi2/nn-imapi2-idiscformat2rawcd)
- [windows-rs Imapi module](https://microsoft.github.io/windows-docs-rs/doc/windows/Win32/Storage/Imapi/index.html)
- [cdrdao](https://github.com/cdrdao/cdrdao) — `dao/GenericMMC.cc` is the reference MMC sequence
- [futureburn](https://github.com/sp00nznet/futureburn) — MIT, C#; IMAPI2 + raw SPTI engines and a CD-TEXT encoder
- [ANSI X3.304-1997 (MMC-1)](http://www.13thmonkey.org/documentation/SCSI/x3_304_1997.pdf) —
  the cue sheet, CTL/ADR and DATA FORM tables. **Predates CD-TEXT; do not use it
  as the authority for anything lead-in related.**
- [libcdio CD-TEXT format reference](https://libcdio.github.io/cd-text-format.html) —
  pack layout, SIZE_INFO offsets, CRC, language codes
- [cdrtools licensing history](https://lwn.net/Articles/195167/) — why we don't bundle it
