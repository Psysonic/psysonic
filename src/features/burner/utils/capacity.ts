/**
 * Red Book capacity arithmetic for the burner UI.
 *
 * Mirrors `psysonic-burn::plan` so the disc ring can respond instantly to a
 * drag without an IPC round-trip. Rust stays authoritative: `burn_start`
 * re-plans against the rendered sector counts and the disc actually loaded
 * before a single sector is written.
 */

/** CD sectors per second. One sector is one MSF frame. */
export const SECTORS_PER_SECOND = 75;

/** Mandatory 2-second pregap ahead of track 1. */
export const PREGAP_SECTORS = 150;

/** The original Red Book capacity — still the safest target for old players. */
export const RED_BOOK_74_MIN_SECTORS = 333_000;

/** Typical 80-minute CD-R capacity (79:57:74), used until a disc reports its own. */
export const DEFAULT_80_MIN_SECTORS = 359_849;

/** Red Book allows at most 99 tracks per session. */
export const MAX_TRACKS = 99;

/** A CD track must run at least 4 seconds. */
export const MIN_TRACK_SECTORS = 4 * SECTORS_PER_SECOND;

export interface BurnQueueTrack {
  /** Stable key: `${serverId}:${trackId}`. */
  key: string;
  serverId: string;
  trackId: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  coverArt?: string;
  /** Container extension, so a fetched file gets a decodable name. */
  suffix?: string;
  /** File size the server reports, for the download estimate. */
  sizeBytes?: number;
  /**
   * Local file backing this track. `undefined` = not resolved yet,
   * `null` = not cached, so the burn fetches it first.
   */
  localPath?: string | null;
}

export interface DiscArc extends BurnQueueTrack {
  /** 1-based CD track number. */
  number: number;
  startSector: number;
  sectors: number;
  /** Degrees clockwise from 12 o'clock. */
}

export interface DiscLayout {
  arcs: DiscArc[];
  totalSectors: number;
  capacitySectors: number;
  remainingSectors: number;
  fits: boolean;
  /**
   * Past the 74 minutes Red Book specifies. Advisory only — 80-minute discs
   * are overburns of a 74-minute standard, and some older players baulk.
   */
  pastRedBook74: boolean;
}

export function secondsToSectors(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.ceil(seconds * SECTORS_PER_SECOND);
}

export function sectorsToSeconds(sectors: number): number {
  return sectors / SECTORS_PER_SECOND;
}

/** `mm:ss:ff` — the notation on every CD spec sheet. */
export function formatMsf(sectors: number): string {
  const safe = Math.max(0, Math.round(sectors));
  const frames = safe % SECTORS_PER_SECOND;
  const totalSeconds = Math.floor(safe / SECTORS_PER_SECOND);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}:${pad(frames)}`;
}

/** `m:ss`, for durations shown next to titles. */
export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

/**
 * Lay the running order out on a disc.
 *
 * Sector positions here are disc-absolute: the walk starts at the 150-sector
 * pregap, because that is where track one physically lands. The ring works in
 * the drive's space instead — program-area sectors counted from zero, which is
 * what every backend reports — so `discGeometry` does its own walk rather than
 * reading these positions. The two spaces are one pregap apart and must never
 * be compared without saying which is which.
 *
 * `gapless` has to be here because it costs disc. A gapped disc pauses two
 * seconds before every track after the first, and those 150-sector pauses take
 * as much room as audio would. This is the mirror of `plan_disc` in the Rust
 * crate and has to agree with it: if this arithmetic left the pauses out, the
 * ring would promise a fit that the drive then refused at SEND CUE SHEET —
 * after every track had already been fetched and rendered.
 */
export function layoutDisc(
  tracks: BurnQueueTrack[],
  capacitySectors: number = DEFAULT_80_MIN_SECTORS,
  gapless: boolean = true,
): DiscLayout {
  const capacity = capacitySectors > 0 ? capacitySectors : DEFAULT_80_MIN_SECTORS;
  const arcs: DiscArc[] = [];
  let cursor = PREGAP_SECTORS;

  tracks.forEach((track, index) => {
    // Track 1 is skipped: the cursor already starts after its mandatory
    // pregap, which gapless never removes either.
    if (index > 0 && !gapless) cursor += PREGAP_SECTORS;

    const sectors = Math.max(MIN_TRACK_SECTORS, secondsToSectors(track.durationSec));
    const startSector = cursor;
    cursor += sectors;
    arcs.push({
      ...track,
      number: index + 1,
      startSector,
      sectors,
    });
  });

  const totalSectors = cursor;
  return {
    arcs,
    totalSectors,
    capacitySectors: capacity,
    remainingSectors: Math.max(0, capacity - totalSectors),
    fits: totalSectors <= capacity && tracks.length > 0 && tracks.length <= MAX_TRACKS,
    pastRedBook74: totalSectors > RED_BOOK_74_MIN_SECTORS,
  };
}

/**
 * Why this queue cannot be burned, or `null` when it can.
 *
 * Returns i18n keys plus interpolation values so the caller stays translatable.
 */
export function describeBlocker(
  layout: DiscLayout,
  trackCount: number,
): { key: string; values?: Record<string, string | number> } | null {
  if (trackCount === 0) return { key: 'burner.blockerEmpty' };
  if (trackCount > MAX_TRACKS) {
    return { key: 'burner.blockerTooManyTracks', values: { max: MAX_TRACKS, count: trackCount } };
  }
  if (!layout.fits) {
    const over = layout.totalSectors - layout.capacitySectors;
    return { key: 'burner.blockerOverCapacity', values: { over: formatDuration(sectorsToSeconds(over)) } };
  }
  return null;
}

/**
 * Tracks the burn will have to download first.
 *
 * No longer a blocker — the burn fetches them as its first step — but the UI
 * still says so up front, because it changes how long the burn takes.
 */
export function tracksNeedingDownload(tracks: BurnQueueTrack[]): BurnQueueTrack[] {
  return tracks.filter(track => track.localPath === null);
}

/** Rough bytes the burn will download, for the "will fetch" hint. */
export function estimatedDownloadBytes(tracks: BurnQueueTrack[]): number {
  // 125 kB/s ≈ 1000 kbps, comfortably above CD-rate FLAC, so the estimate
  // errs high rather than surprising the user. Mirrors the Rust fallback.
  const ASSUMED_BYTES_PER_SECOND = 125_000;
  return tracksNeedingDownload(tracks).reduce((total, track) => {
    if (track.sizeBytes && track.sizeBytes > 0) return total + track.sizeBytes;
    return total + Math.round(Math.max(0, track.durationSec) * ASSUMED_BYTES_PER_SECOND);
  }, 0);
}

/** Human-readable byte size for the download hint. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
