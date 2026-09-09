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
  startAngle: number;
  endAngle: number;
}

export interface DiscLayout {
  arcs: DiscArc[];
  totalSectors: number;
  capacitySectors: number;
  remainingSectors: number;
  fits: boolean;
  pastRedBook74: boolean;
  /** Degrees at which the 74:00 mark sits on this disc. */
  redBook74Angle: number;
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
 * The full circle is the disc's capacity, so the arcs and the 74:00 mark share
 * one scale and the ring reads as a real capacity gauge.
 */
export function layoutDisc(
  tracks: BurnQueueTrack[],
  capacitySectors: number = DEFAULT_80_MIN_SECTORS,
): DiscLayout {
  const capacity = capacitySectors > 0 ? capacitySectors : DEFAULT_80_MIN_SECTORS;
  const arcs: DiscArc[] = [];
  let cursor = PREGAP_SECTORS;

  tracks.forEach((track, index) => {
    const sectors = Math.max(MIN_TRACK_SECTORS, secondsToSectors(track.durationSec));
    const startSector = cursor;
    cursor += sectors;
    arcs.push({
      ...track,
      number: index + 1,
      startSector,
      sectors,
      startAngle: (startSector / capacity) * 360,
      endAngle: (Math.min(cursor, capacity) / capacity) * 360,
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
    redBook74Angle: (RED_BOOK_74_MIN_SECTORS / capacity) * 360,
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
