# CD Burner — design document

**Status:** shipping on **Windows, macOS and Linux**, all three verified on
hardware — audio, gapless Disc-At-Once, and **CD-TEXT confirmed by reading it
back off a burned disc**. See [`macimplementation.md`](./macimplementation.md)
for the macOS specifics.

**Scope:** burn a Red Book audio CD-R from library tracks, with CD-TEXT readable
by players that support it.

Tracks that are not already cached offline are **downloaded by the burn itself**
as its first step — no manual "make available offline" detour.

---

## Contents

- [1. Why this lives in-tree](#1-why-this-lives-in-tree)
- [2. What already exists that we reuse](#2-what-already-exists-that-we-reuse)
- [3. Why CD-TEXT needs its own write path](#3-why-cd-text-needs-its-own-write-path)
- [4. Two write paths](#4-two-write-paths)
- [5. Architecture](#5-architecture)
- [6. Audio pipeline spec](#6-audio-pipeline-spec)
- [7. Windows burn path](#7-windows-burn-path)
- [8. CD-TEXT encoding](#8-cd-text-encoding)
- [9. Linux and macOS](#9-linux-and-macos)
- [10. UI — the disc](#10-ui--the-disc)
- [11. Risks](#11-risks)
- [12. What this cost, and the lesson](#12-what-this-cost-and-the-lesson)
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
coverage hot-path floors, i18n keys in `src/locales/en/burner.ts`).

## 2. What already exists that we reuse

| Asset | Location | Use |
| --- | --- | --- |
| `windows` crate 0.62 | `src-tauri/Cargo.toml` | IMAPI2 is at `windows::Win32::Storage::Imapi`. `psysonic-burn` takes the same crate and version with `Win32_Storage_Imapi` added, so IMAPI2 brings in no third-party code the tree did not already carry. |
| Win32 COM precedent | `src-tauri/src/taskbar_win.rs` | `ITaskbarList3` + `CoInitializeEx` already shipped. Establishes the pattern for COM lifetime, apartment threading and pointer handling in this codebase. |
| Symphonia | `src-tauri/Cargo.toml` | The decoder the player already uses, with the same codec set, so anything that plays can be burned. `render.rs` opens its own session rather than borrowing the analysis one: `open_decode_session` is `pub(super)` inside `psysonic-analysis`, takes the whole file as a `&[u8]`, and feeds a mono sink — the burn streams from disk and needs stereo. |
| Local file cache | `psysonic-syncfs` | A cache hit means the burn downloads nothing for that track. |
| Download transport | `psysonic-syncfs::file_transfer` | `subsonic_http_client` + `apply_server_http_get` (per-server headers/certs) + `finalize_streamed_download` (`.part` + atomic rename) are already `pub`. The fetch step composes them; syncfs needed no changes. |
| Job pipeline | `src/features/deviceSync/**` | Progress + cancel + finalize + error-toast flow over Tauri events. The burn job copies this shape exactly. |
| `ebur128` | `src-tauri/Cargo.toml` | Already in the tree. Optional normalisation, measured and applied per track against a shared target, so a compilation drawn from different albums plays evenly. |
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

**IMAPI2 (`win.rs`) — the path without CD-TEXT, and the fallback.**
`IRawCDImageCreator` + `IDiscFormat2RawCD`. Gapless DAO, ISRC, MCN, capacity
validation. Works on every Windows machine, unelevated. No CD-TEXT.

**Session-At-Once (`win_sao.rs`) — when CD-TEXT is asked for.**
Hand-rolled MMC, gated on the drive's own capability report. CD-TEXT is on by
default, so on a drive that reports the capability this is the ordinary path and
IMAPI2 is what a refusal falls back to, not what most burns take. It replaces
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

Workspace crate `src-tauri/crates/psysonic-burn/`:

```
src/
  lib.rs           — public surface
  model.rs         — Red Book constants + IPC DTOs
  fetch.rs         — downloads a track the cache does not hold, plus the free-space
                     arithmetic that has to promise the room before it starts
  plan.rs          — disc layout and capacity arithmetic (pure)
  render.rs        — decode -> 44.1k/16-bit/stereo -> sector-aligned PCM on disk
  job.rs           — cancel registry + the two Tauri events
  platform.rs      — dispatch to the per-OS backend
  commands.rs      — the Tauri surface + the burn orchestrator
  cdrom_info.rs    — /proc/sys/dev/cdrom/info parsing; only Linux uses it, but it
                     is pure, so it compiles and tests everywhere
  cdtext/          — pack encoder (pure, heavily tested)
  mmc/             — cue sheet, mode page 05h, CDBs (pure, heavily tested)
  win.rs           — IMAPI2: image creator, format2rawcd, capability probe
  win_sao.rs       — the Session-At-Once write that carries CD-TEXT
  linux/           — sg.rs is the SG_IO transport; sao.rs runs the same SAO
                     sequence as win_sao.rs over it
  macos.rs         — DiscRecording.framework, which writes CD-TEXT itself
  macos_ffi.rs     — hand-written DRCore*/CoreFoundation bindings
```

`plan.rs` and `render.rs` carry no platform or COM types — that is where the
unit tests live, and it keeps the untestable hardware layer thin. The layout is
flatter than originally sketched because `render` and `plan` each stayed small
enough to read in one file; split them when a second backend needs to share
pieces.

### Command surface

Additive only, per the Rust ↔ frontend contract in `CONTRIBUTING.md`:

```
burn_is_supported()                     -> bool     // is there a backend on this OS at all?
burn_list_recorders()                   -> Vec<BurnRecorder>  // and what each can do
burn_probe_media(recorder_id)           -> BurnMediaInfo   // present? blank? capacity, speeds
burn_media_state(recorder_id)           -> String   // opaque token; poll it to notice a disc change
burn_reload_media(recorder_id)          -> ()       // eject and pull back in, so the drive re-reads
burn_plan(tracks, capacity_sectors, gapless) -> BurnPlan // sector counts, total time, warnings
burn_start(job_id, tracks, options)     -> ()       // watch the events for the rest
burn_cancel(job_id)                     -> bool     // false: it had already finished
burn_erase(recorder_id, quick)          -> ()       // CD-RW
burn_verify_cd_text(recorder_id)        -> CdTextVerification
```

Everything but `burn_is_supported` and `burn_cancel` returns `Result<_, String>`,
and the error string is what the toast shows, so it is written for the user.

Two of those shapes are deliberate. **The caller mints the `job_id`** rather than
receiving one, because the frontend has to have its job store keyed and
listening before the first `burn:progress` can land; handing the id back would
leave a window where events arrive for a job the UI does not yet know about.
And **`burn_cancel` returns a bool** — `false` means the job had already
finished, which is not an error but does change what the UI should say.

### Events

Mirroring `device:sync:*`:

```
burn:progress   { jobId, phase, trackIndex, sectorsDone, sectorsTotal, msf, bufferPercent }
burn:complete   { jobId, cancelled, tracksWritten, sectorsWritten, error,
                  testWrite, cdTextWritten, cdTextVerification }
```

`trackIndex` is 0-based, and only `fetching` and `rendering` carry one. A
`WRITE(10)` reports sectors, not tracks, so it is `null` for the whole burn on
every backend: the ring and the running order both find the track under the head
from `sectorsDone` instead, walked through the same slices, which is why the row
and the wedge can never disagree. `bufferPercent` is `null` where the backend
does not report it. `msf` is `sectorsDone` already formatted as
minutes:seconds:frames, emitted rather than derived so the disc position the UI
shows is the one the backend actually wrote.

`burn:complete` is the `BurnResult` DTO, camel-cased by serde. `error` is `null`
on success and carries the reason otherwise — there is no separate `failed`
flag. `cdTextVerification` is `null` when no read-back was attempted, which a
rehearsal never does.

`phase` is one of `fetching | analyzing | rendering | preparing | writing | closing`.
`analyzing` is in the enum and carries a translation, but nothing emits it:
loudness is measured inside `prepare_track`, between the fetch and the render,
and the only phase that step reports is `rendering`. The five that do arrive are
worth telling apart because only `writing` and `closing` light the disc — the
others take most of the wall-clock and write nothing, so a lit disc there would
claim a burn that has not started. See section 10.

### Frontend

```
src/features/burner/
  README.md               — this file
  macimplementation.md    — the macOS specifics
  index.ts                — barrel (cross-feature access goes only through here)
  pages/Burner.tsx        — lazy route at /burn, mirroring AppRoutes.tsx:126
  components/
    BurnDisc.tsx          — the centrepiece, see section 10
    BurnChassis.tsx       — title, disc name and drive row as one strip
    BurnAlertLine.tsx     — one always-present line, severity-ranked
    BurnSeam.tsx          — the gutter that resizes the running order
    BurnMetrics.tsx       — stage-aware figures; measured, never predicted
    BurnSpeedTrace.tsx    — the write rate as a line, because a figure hides a sag
    BurnModeSwitch.tsx    — burn or rehearse, beside the button it changes
    BurnStageNote.tsx     — the fixed slot under the transport, ending in the outcome
    BurnTrackList.tsx     — the running order, and where reordering happens
    BurnOptionsPanel.tsx  — speed, gapless, normalisation, eject, CD-TEXT
    RecorderPicker.tsx    — drive selector plus what is in it right now
    TrackListingModal.tsx — the running order as text, to print or keep
  hooks/useBurnJobEvents.ts     — the two Tauri events into burnJobStore
  hooks/useBurnRecorders.ts     — drive list, media probe, and the state poll
  hooks/useBurnTiming.ts        — samples the sector counter while writing
  hooks/useBurnerSplit.ts       — the measured page width, the cols regime, the seam
  hooks/useBurnListAutoscroll.ts — drag autoscroll for a 99-row list
  store/burnListStore.ts     — the queue and the disc title
  store/burnJobStore.ts      — the running job
  store/burnSupportStore.ts  — whether this machine can burn, cached for the menu
  store/burnerLayoutStore.ts — the running order's width, persisted
  utils/capacity.ts       — sector/time math and what blocks a burn
  utils/discGeometry.ts   — the ring's angles and the SVG paths that draw them
  utils/burnStage.ts      — the four stages, and every layout constant
  utils/burnTiming.ts     — the measured write rate
  utils/burnOutcome.ts    — what happened, and what the disc is now
  utils/arcColor.ts       — the six accents the arcs and rows share
  utils/arcRgb.ts         — those same accents resolved to channels, for canvas
  utils/trackListing.ts   — the running order as text
  utils/addToBurnList.ts  — the context-menu entry point
```

The mode switch is why `BurnOptionsPanel` no longer lists a test-write toggle:
rehearse-or-burn is a MODE, and it belongs beside the control it changes rather
than four hundred pixels away in another column, where its only visible effect
was that the primary button silently retitled itself.

Every module under `utils/` that computes something has a `.test.ts` beside it,
and the stores are tested the same way; `arcColor.ts` is the exception, being a
six-entry lookup. That is deliberate — it keeps the parts that decide what gets
burned testable without a drive. Most of `utils/` is pure, but `arcRgb.ts` is
not and cannot be: turning `var(--ctp-mauve)` into channels means reading
`getComputedStyle` off the document root and normalising the result through a
canvas `fillStyle`, which is exactly why it is tested rather than trusted.

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
  crossfade blend, *not* for a 48 kHz -> 44.1 kHz master, so `render.rs` uses
  `rubato`'s `SincFixedIn` (MIT) instead, and builds one only when the source
  rate is something other than 44 100.
- **Dither.** TPDF dither on the f32 -> i16 conversion. Truncation is audible on
  quiet passages.
- **Normalisation (optional, off by default).** `ebur128` measures each track,
  and **each one** is brought to a shared target (-14 LUFS). This is
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

**Fetch → measure → render → delete the source, on up to eight tracks at once.**
That per-track sequence is what keeps the whole download set off the disk: each
source is deleted the moment its track is rendered, so what is live at any point
is the accumulating PCM plus at most one source per worker. Fetching stays
serialised behind a single gate — it is network-bound, and parallel downloads
would only make one server race itself — but the decode, resample and dither
after it are not, because doing that one core at a time was by far the slowest
part of a burn. Parallelising is sound because normalisation gain is computed
against a fixed target rather than against the other tracks, so no track needs
to know about any other, and each render lands in its own slot by track index,
so the running order never depends on which worker finished first.

The worker count is `min(cores, 8, tracks)`. Eight is not a CPU ceiling —
decoding scales past it happily — it is a disk ceiling, because
`fetch::estimated_peak_bytes` has to promise the space up front and reserves the
PCM plus the largest that-many sources. `fetch::check_free_space` refuses the
job on that figure rather than failing at sector 200 000.

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
6. `MsftRawCDImageCreator` -> `SetDisableGaplessAudio`,
   `AddTrack(IMAPI_CD_SECTOR_AUDIO, stream)` per track, per-track ISRC, MCN.
   The property is named for the negative, so gapless — the default — is
   `VARIANT_FALSE`, and it is set from the option rather than pinned.
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

**Image streaming.** `AddTrack` takes an `IStream`, and `open_file_stream` wraps
each rendered temp file with `SHCreateStreamOnFileEx` — up to ~846 MB of temp
space for a full disc, which `fetch::check_free_space` promises before a single
track is decoded rather than discovering it at sector 200 000. Implementing
`IStream` in Rust via `windows-implement` and generating sectors on demand would
remove that cost; it has not been worth doing, because the render has to be
finished on disk anyway to keep the write loop free of the decoder.

### The CD-TEXT path (`win_sao.rs`)

Same enumeration and exclusive access, then the write is driven directly:
`GetFeaturePage` for the capability, `GetModePage`/`SetModePage` for the Write
Parameters page, and `SendCommandSendDataToDevice`,
`SendCommandGetDataFromDevice` and `SendCommandNoData` for everything else. The
sequence they carry is section 8a's: Windows and Linux run the same `mmc/`
command blocks and the same cue sheet, and only the transport differs. It is
written down in one place because it was once written down in two, and the two
drifted.

Two different "test writes" exist, and the difference matters:

- **IMAPI2 path** — `IDiscFormat2RawCD` exposes no simulate flag, so the
  rehearsal runs everything up to `WriteMedia` and stops. It proves the drive
  and disc are usable; it does not exercise the write.
- **CD-TEXT path** — mode page `05h` bit 4 is a real laser-off test write, so
  the rehearsal runs the *entire* sequence including every `WRITE(10)`. If a
  drive is going to reject our cue sheet or lead-in, this finds out for free —
  worth doing on any drive not tried before, and it has saved a great many
  discs.

**Expect per-drive quirks.** cdrdao carries a `variant` fallback loop precisely
because drives disagree about cue-sheet and data-block-type acceptance. There is
no such ladder here, and no drive tried so far has needed one: the mode page
sent back is the drive's own with only the fields the burn depends on changed,
and a refusal is a `Setup` error that costs the user CD-TEXT rather than a disc.
A ladder is where to start if a drive does say no.

## 8. CD-TEXT encoding

**Status: built and verified** (`src/cdtext/`, 39 tests). The encoder and the
device-side write that carries it to the lead-in are both done, on all three
platforms, confirmed by reading the text back off a burned disc — see section 8a
for the write and section 12 for what getting it right cost.

Pure Rust in `cdtext/`, no platform code, fully unit-testable against known-good
byte vectors.

- Packs are **18 bytes**: 4 header (pack type, track number, sequence,
  block/character position) + 12 data + 2 CRC.
- CRC is **CRC-16-CCITT** (polynomial `0x1021`), stored inverted.
- The format defines pack types `0x80`–`0x8F`. `encode_packs` writes three of
  them: `0x80` TITLE, `0x81` PERFORMER and `0x8F` SIZE_INFO. Songwriter,
  composer, arranger, message, disc ID and genre are left out because the
  library does not carry them, and inventing them would put guesses on a disc
  that cannot be rewritten.
- The **track-number byte** is `0x00` for the disc-level title and performer,
  and `0x01..n` for the per-track ones.
- `0x8F` SIZE_INFO is generated last and takes three packs — it counts the packs
  of every type, itself included, so nothing may be added after it.
- Up to 8 language blocks. One is written: block 0, declared English (`0x09`).
- Character set ISO-8859-1. `to_latin1` transliterates anything outside it and
  strips combining marks, so a decomposed accent folds to its base letter
  instead of becoming two replacement characters; `?` is the last resort.
  Encoding can still fail outright — no text at all, more than 99 tracks, more
  than 255 packs — and the reason is then logged and the disc burned without
  CD-TEXT rather than not burned.

Layout was verified against the libcdio CD-TEXT format reference before being
trusted, and the SIZE_INFO offsets below are the confirmed ones:

| Offset | Field |
| --- | --- |
| 0 | Character code (`0x00` ISO-8859-1) |
| 1 | First track |
| 2 | Last track |
| 3 | Copyright flags — written `0x00`, because we know of none to assert |
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
no parity beyond each pack's CRC). Both hand-rolled backends then run the same
sequence over them — Windows reaching the drive through
`IDiscRecorder2Ex::SendCommand*`/`SetModePage`, Linux through `SG_IO`, and
nothing above the transport differing:

1. `MODE SELECT` page `05h`: write type SAO, and Data Block Type 3 — raw P-W —
   because a CD-TEXT lead-in is coming. The page is read back off the drive and
   edited in place; vendor defaults live in fields we have no business
   rewriting, and overwriting them is one of the ways a cue sheet gets refused.
2. `READ DISC INFORMATION` for this disc's own lead-in start.
3. `SEND CUE SHEET` (`0x5D`) describing the TOC, that start included. When the
   disc is gapped rather than gapless, `build_cue_sheet` also gives every track
   after the first an index 00 of its own — a 150-sector pause the drive
   generates, so no extra bytes are transferred and only the addresses from that
   pause onwards move.
4. `WRITE(10)` (`0x2A`) the lead-in, from `-150 - lead_in_sectors` up to the
   pregap at −150, 96 bytes of raw subchannel per sector.
5. `WRITE(10)` the program area from LBA 0, 2352 bytes per sector.
6. `SYNCHRONIZE CACHE` (`0x35`), so the drive has finished with the disc before
   we let go of it. There is no `CLOSE TRACK/SESSION` command: a Session-At-Once
   write closes the session itself, from the cue sheet it was given.

Steps 1–3 are negotiation and leave the disc untouched. **The first `WRITE(10)`
is the point of no return**, and that is what the split in `SaoError` names:

- `Setup` — the drive refused the mode page, the disc query or the cue sheet.
  Nothing has touched the disc, so Windows falls back to the IMAPI2 path and
  burns without CD-TEXT. Linux has no second path, so it reports the refusal
  rather than quietly retrying a different way.
- `Write` — the laser was already on. The disc is spoiled and the error
  propagates; no retry is attempted onto it.

A drive whose buffer is full answers a `WRITE(10)` with sense `2/04/08` — not
ready, long write in progress. That is back-pressure, not a failure: both
backends wait 40 ms and send the same block again, up to a thousand times, about
40 seconds, because a drive can legitimately hold the host off that long and
giving up early aborts the burn and spoils the disc. Only that exact triplet is
retried. Matching any ASCQ under `2/04` also caught `2/04/03`, the drive waiting
on the user, which never clears by itself and burned the whole budget sleeping
before it was reported.

Two questions this section once listed as open are now answered, though not
from the same place — and which place mattered:

- **P and Q are the drive's job.** §6.2.11.3: *"The P and Q sub-channel
  information contained within the Subcode Data shall be ignored. The P and Q
  sub-channel information is generated by the drive and based on the content of
  the cue sheet."* The encoder leaves those bits clear, which is correct. This
  one the specification did answer.
- **The lead-in length is the disc's, not ours.** `READ DISC INFORMATION` bytes
  17..20 give the lead-in start as an MSF address — around 97 minutes on a blank
  CD-R — and the lead-in runs from there to 100:00:00, sector 450 000, where the
  address wraps to zero. So `lead_in_sectors` is `LEAD_IN_END - start`, ~13 500
  sectors, and a start outside the believable window — before 80 minutes, or at
  the wrap point or past it — takes the conventional one-minute fallback. The
  packs are repeated over and over to fill it, because a player picks the text
  up wherever in the lead-in it happens to start reading. This section once said
  the length was derived from the pack count, `ceil(packs / 4)`; that is wrong
  turn #1 in section 12, and no specification said otherwise — a working
  implementation did.

The DATA FORM byte (Tables 160 and 163) is the pivot: bits 7-6 select the
sub-channel form (`01` = RAW, 96 bytes from the host), bits 3-0 the main-data
form (`0` = host sends 2352, `1` = the drive generates the frame). So the
CD-TEXT lead-in entry is **`41h`** — drive-generated main channel, host-supplied
raw P-W — and the program area stays `00h`.

Two further defences, because inter-drive variance in SAO writing is the
best-documented pain point in CD burning:

1. **Capability gate.** MMC feature `002Eh`, CD Mastering, carries both bits
   this write needs in byte 4 of its descriptor: Session-At-Once and
   host-supplied R-W subchannel. `BurnWriteCapabilities::can_write_cd_text`
   demands both, and that the drive answered at all. Windows reads the
   descriptor through IMAPI2's `GetFeaturePage`, Linux through
   `GET CONFIGURATION`, and the two decode it identically. A drive that says no
   never sees the option, so it cannot fail at it.
2. **Read-back verification.** After a real burn — never a rehearsal — the same
   `READ TOC/PMA/ATIP` format `0101b` returns the CD-TEXT actually stored in the
   lead-in, and only packs whose CRC checks out are counted. A drive that claims
   the capability and writes nothing is caught by its own disc and reported,
   rather than leaving the user to wonder why their player is blank. A drive
   that simply refuses the query is reported as unreadable, which is a different
   thing and is said differently: conflating the two is wrong turn #3 in
   section 12. Drives cache the table of contents they read at load time, so a
   count of zero straight after a burn is not proof of a blank lead-in. Only a
   reload clears that cache, and the two are separate commands behind separate
   buttons: `burn_reload_media`, then `burn_verify_cd_text` to ask again.

`sp00nznet/futureburn` (MIT, C#) was the licence-compatible encoder reference
while `cdtext/` was being written; it is worth a look only for cross-checking
now that ours exists and reads back off real discs. cdrdao is the better
protocol reference — `GenericMMC.cc` is what finally settled the lead-in — but
check its headers before copying any code, because GPL-2.0-*only* code cannot be
merged into this GPL-3.0-or-later tree.

## 9. Linux and macOS

**Linux.** Implemented in `linux/`. `SG_IO` ioctl passthrough, running the same
MMC sequence as `win_sao.rs` — the cue sheet, mode page `05h` and the CD-TEXT
lead-in are literally the same `mmc/` and `cdtext/` code the Windows burn uses,
so only the transport differs.

There is no second path to fall back to, so Session-At-Once is the only write
mode, with or without CD-TEXT. Two things Windows got from IMAPI2 had to be
built by hand and now live in `mmc/scsi.rs`: `GET CONFIGURATION` for the CD
Mastering feature (`002Eh`), and `MODE SENSE`/`MODE SELECT(10)` around the
Write Parameters page. Drive discovery reads `/proc/sys/dev/cdrom/info` rather
than probing, so listing drives does not spin up every optical device in the
machine.

Permissions are the usual first failure: the user must be in the `cdrom` group,
and `sg.rs` says so by name rather than reporting a bare `EACCES`.

Verified on hardware against an HL-DT-ST DVDRAM GP65NB60 over USB: discovery,
the capability probe (which reports bit-for-bit what the Windows path reports
for the same drive), blank detection, ATIP capacity, the Write Parameters
negotiation, the cue sheet, test writes both with and without CD-TEXT, and a
real burn read back afterwards.

Three bugs came out of that session, none of which a unit test would have
caught, and all three are worth knowing about because the wrong version looked
entirely plausible:

- `read_to_string` on `/proc/sys/dev/cdrom/info` returns **one short chunk**.
  Files under `/proc/sys` come from the sysctl interface, which reports a size
  of zero and serves the whole table in a single read; the size hint made Rust
  take 32 bytes and stop. The parser then worked perfectly on a truncated first
  line and every drive silently vanished. `read_kernel_table` does one big read.
- Capacity came back as 150 sectors — the pregap — because the TOC query
  answered with the *first track's* start rather than the lead-out. A blank CD-R
  has no TOC at all, so its capacity can only come from ATIP,
  `READ TOC/PMA/ATIP` format `0100b`: bytes 12..15 hold the last possible
  lead-out. Bytes 8..11 are the lead-*in* start and parse just as happily, into
  a disc that looks 97 minutes long. `disc_capacity_sectors` asks ATIP first for
  that reason, and reads the TOC only for a disc that already has one.
- The CD-TEXT block was built from the first track's performer rather than the
  disc performer the user typed, which would have produced different discs from
  the same queue depending on the platform.

**macOS.** Implemented in `macos.rs` / `macos_ffi.rs`.
`DiscRecording.framework` supports CD-TEXT natively via `DRCDTextBlock` — the
only platform where it is first-class — so none of §7's MMC work applies. The
bindings are hand-written, but against the framework's CoreFoundation-level
`DRCore*` C API rather than `objc2`: plain `extern "C"`, no new dependencies,
no `build.rs`. Tracks are fed by a `DRTrackCallbackProc` producer, which takes
the sector-aligned PCM `render.rs` already writes, unchanged. Read-back is the
one place it is poorer: there is no command passthrough, so the burned text is
checked by running `/usr/bin/drutil cdtext` and counting the entries in its
output, and anything it cannot parse is reported as unreadable rather than as an
empty disc. Details, and what is and is not verified on hardware, are in
[`macimplementation.md`](./macimplementation.md).

**Do not bundle cdrtools/cdrecord.** It is CDDL; combining it with a GPLv3 tree
is a real distribution problem and the reason Debian forked cdrkit. cdrdao is
licence-workable as a separate process, but its Windows binaries are ASPI-era
and effectively unmaintained — not something to ship in an app that builds its
own audio stack.

## 10. UI — the disc

The centrepiece (`BurnDisc.tsx`) is an actual disc: a ring where each track is a
wedge, sized by duration and coloured from a small palette, which becomes the
progress indicator once the laser is on.

- **Geometry** (`discGeometry.ts`). The queue fills the circle: the tracks,
  clockwise from 12 o'clock, and no headroom beyond them. There is no pregap on
  the ring — the scale is the program area counted from sector zero, which is
  the space every backend reports `sectorsDone` in. `layoutDisc` counts disc-absolute
  sectors and so starts at 150, which is why `discGeometry` walks the arc
  lengths itself rather than reading `arc.startSector`: when it did not, the
  drawing and the counter it was fed disagreed by exactly 150 for the whole
  burn, every tick landed a frame late, and the last track never reached the end
  of its own wedge. The circle was drawn to the disc's capacity at first, and
  that was worse in two ways: a 39-minute queue on an 80-minute disc filled half
  the ring, which read as a fault rather than as headroom, and the burn fill
  then no longer meant a plain 0–100%. Headroom is stated in words instead:
  remaining time in the hub, the disc's real capacity in the drive bar.
- **Colour** (`arcColor.ts`). Six of the theme's accents, cycled, shared with the
  rows in the running order so a wedge and its row are obviously the same track.
  Six rather than every accent: teal and lavender were in there once and were
  what made a full disc read as a grey smear. The hairline between wedges is cut
  off the end of each one, so the gaps land on track boundaries instead of at
  some fixed interval that agrees with the running order only by accident.
- **Limits.** Past 74 minutes is an advisory line under the controls and nothing
  on the ring, because a Red Book 74-minute disc is a real thing a user might be
  holding but is not a wall. Past the probed capacity is a blocker line, Burn is
  disabled, and the ring says *which* tracks are the problem: a dashed radial
  mark where the loaded disc runs out, and a wash over everything past it.
  `BurnDisc` works that angle out from the layout when the caller passes none,
  because a marker that appears only if a call site remembers to compute it is a
  marker that goes missing. Turning gapless off moves it — `layoutDisc` takes
  the flag and charges 150 sectors for every track after the first, mirroring
  `plan_disc`, so the ring cannot promise a fit the drive would refuse at
  `SEND CUE SHEET` once everything had already been fetched and rendered.
- **Hub.** Four states. Writing or closing, it is the phase — or "Rehearsing",
  for a test write — the percentage of the queue written, and which track the
  head is in. Fetching, rendering or preparing, it is the phase, how far through
  that phase the sectors have got, and a line saying what that phase does; the
  disc takes `is-preparing` and the unwritten program area breathes under it,
  because nothing is on the disc yet. That figure is measured rather than
  counted: rendering runs several tracks at once, so a "4/16" jumped about and
  went backwards as workers finished out of order. The track number is only the
  fallback for a phase that has reported no sectors yet, and `···` the fallback
  for one with no track to name either. Idle, it is the remaining time and the
  track count — or the overrun, when the queue does not fit. An empty queue
  takes the remaining branch and adds `is-empty`: it is not over capacity,
  whatever the arithmetic says, and it used to share the overrun branch and read
  "OVER BY 0:00" on a page nothing had been put on yet.
- **Not interactive.** The ring is one `role="img"` with a single label, and it
  has no pointer handlers. Every track on it is also a row in the list beside
  it, and that row is focusable, reorderable by drag or Alt+Arrow, and carries
  the same numbers — so putting focus and labels on up to 99 wedges as well
  would be duplicate tab-stops for information the user already has a better
  route to. Hovering a row does mark its wedge, by dimming the others rather
  than brightening it: stacking more opacity onto an already-lit wedge blew it
  out to near-white, and taking light away from its neighbours cannot. Once the
  laser is on, hover still dims the rest but no longer picks the marked wedge —
  that follows the head instead, because the head is null at both ends of a burn
  and pointing at a row during the closing phase used to move the mark off the
  disc's real position and relabel the hub's "Track N of M" to whatever the
  cursor was over.
- **Burn progress.** The written portion grows clockwise as sectors are
  reported: the visualisation *is* the progress bar. A head sits at the leading
  edge, a waveform trails it, and sparks burst as it crosses into a new track.
  The waveform is a trail of about 46 degrees rather than a line over everything
  written so far — drawn across the whole written arc it buried the wedges the
  ring exists to show. One `requestAnimationFrame` loop drives both canvases and
  is torn down whenever the laser is off, so an idle burner page costs nothing
  per frame. A finished disc stays lit, and lit to the rim: the overlay used to
  go the instant the job ended, so the one moment worth looking at — the whole
  circle written — was the one moment never shown. Under
  `prefers-reduced-motion` the head still follows the burn, because where the
  laser has reached is the information — and it was never animated to begin
  with: its angle is redrawn from each progress event. What goes is the
  decoration. The component throws no sparks, the waveform canvas is hidden in
  CSS because it animates in place, and the wedge and lead-in transitions, the
  diffraction's slow turn, the finished disc's brightness flash and the
  preparing pulse are all dropped.
- **Timing** (`BurnMetrics.tsx`). Elapsed, remaining and total, every one of them
  measured. Nothing is predicted before the laser starts: "Automatic" means the
  drive picks its own speed and the Linux backend does not report speeds at all,
  so the total shows the queue's runtime — a fact about the music — until there
  are real sectors to measure a rate from.
- **CD-TEXT.** The disc title is an input in the page header; the disc performer
  is derived, and only when one artist owns the whole queue, because a
  compilation has no honest answer for it. Per-track title and performer come
  from the library rather than being retyped here. When the selected drive's own
  feature page says it cannot write CD-TEXT the toggle stays visible but
  disabled, and its hint names what was missing — no answer at all, no
  Session-At-Once, or no R-W subchannel. People come to this screen looking for
  CD-TEXT, and hiding the control reads as the feature being broken rather than
  as their hardware saying no.

Built entirely from existing CSS custom properties so community themes apply
without extra work.

Route at `/burn`, lazy-loaded, mirroring `src/app/AppRoutes.tsx:126`. Entry
points: the sidebar item, which ships hidden (`sidebarStore`) because most
machines no longer have a drive, plus "Add to CD" in the existing context menu
for a track, a multi-selection of them, an album, or a playlist. The last two
queue the whole thing: the menu resolves the track list on click and appends it
in the order the album or playlist already has — disc then track for an album,
the saved running order for a playlist — so a right-click on a record puts the
record on the disc. `useBurnMenuAvailable` gates that item on three things: the
backend reporting support, the sidebar entry being switched on — so the item
never queues tracks onto a page the user has no way to reach — and the offline
policy's `canAddToPlaylist`, borrowed deliberately, because a burn fetches
anything not already cached.

## 11. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Drive doesn't support SAO CD-TEXT | High | The feature `002Eh` probe gates the toggle before a disc is even loaded; a `Setup` refusal on Windows falls back to IMAPI2; read-back off the finished disc reports the truth. |
| CD-TEXT writes but reads back empty | Medium | Read-back verification catches it and says so. Seen and fixed once: the lead-in must be filled end to end, not just once. |
| Per-drive cue-sheet incompatibility | Medium | No ladder of variants: the mode page is the drive's own, edited in place, and the cue sheet is built once from it. A refusal is a `Setup` error, so the disc is untouched — Windows then burns through IMAPI2, Linux reports it. |
| Temp space for the raw image | Medium | `fetch::check_free_space` promises the peak — the PCM plus one source per render worker — before anything is decoded, and the workdir goes with the job. |
| Buffer underrun on slow sources | Medium | Render fully to disk before writing. Never decode inside the write loop. |
| Resample quality regressions | Low | `rubato`'s sinc resampler, and only when the source is not already 44 100 Hz. Covered by the channel-fold and dither tests either side of it, not by an audio snapshot. |
| No hardware simulator | Medium | The MMC Test Write bit on the CD-TEXT path, which is a real laser-off write; the IMAPI2 path has no simulate flag, so its rehearsal runs everything up to `WriteMedia` and stops. |
| Progress reporting silently dead | Low | Every early return in the sink logs once per burn. The burn itself never depends on the sink. |

## 12. What this cost, and the lesson

The estimates in the original plan were roughly right for the parts that were
understood. The CD-TEXT lead-in was not one of them, and it is where the whole
cost of this feature went.

**Three burns were wasted getting the lead-in right, all from the same root
cause:** the implementation was derived from ANSI X3.304-1997, which is **MMC-1
and contains no mention of CD-TEXT at all**. Its Table 155 note 5 even states
that *"All data for both lead-in and lead-out shall be generated by the drive"* —
so the document being used as the authority describes a world in which the
feature being built cannot exist.

The wrong turns, in order:

1. Wrote a lead-in only as long as the packs themselves, `ceil(packs / 4)`
   sectors. The lead-in is the *whole* lead-in — ~13 500 sectors — with the
   packs repeated to fill it.
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
