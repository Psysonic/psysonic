/**
 * The running order as text, for printing or keeping.
 *
 * A burned CD-R carries no metadata a computer will show you — CD-TEXT is for
 * players, and a ripped disc comes back as "Track 01". The listing is the only
 * durable record of what went on the disc and in what order, which is why it is
 * built from the queue rather than from anything the burn returns: it has to
 * work before the disc exists as well as after.
 */
import type { DiscArc } from '@/features/burner/utils/capacity';
import { formatDuration, sectorsToSeconds } from '@/features/burner/utils/capacity';

/** Widest the credit column is padded to; longer lines simply run on. */
const MAX_PAD = 56;

export interface TrackListingLine {
  /** 1-based, as printed on the sleeve. */
  number: number;
  artist: string;
  title: string;
  duration: string;
  /** Where the track starts on the disc, `m:ss`. */
  startsAt: string;
}

export interface TrackListing {
  discTitle: string;
  trackCount: number;
  totalDuration: string;
  lines: TrackListingLine[];
}

/** An em dash between artist and title, or just the title when unattributed. */
export function creditLine(artist: string, title: string): string {
  const named = artist.trim();
  const named2 = title.trim();
  return named ? `${named} — ${named2}` : named2;
}

export function buildTrackListing(arcs: DiscArc[], discTitle: string): TrackListing {
  const lines = arcs.map(arc => ({
    number: arc.number,
    artist: arc.artist.trim(),
    title: arc.title.trim(),
    duration: formatDuration(arc.durationSec),
    startsAt: formatDuration(sectorsToSeconds(arc.startSector)),
  }));

  const totalSeconds = arcs.reduce((sum, arc) => sum + Math.max(0, arc.durationSec), 0);

  return {
    discTitle: discTitle.trim(),
    trackCount: arcs.length,
    totalDuration: formatDuration(totalSeconds),
    lines,
  };
}

/**
 * Plain text, column-aligned.
 *
 * Padding is measured against this listing rather than a fixed width, so a disc
 * of short titles is not printed with a canyon down the middle. `MAX_PAD` stops
 * one pathological title doing the same in reverse.
 */
export function formatListingAsText(listing: TrackListing, burnedOn: Date): string {
  const numberWidth = String(listing.trackCount).length;
  const credits = listing.lines.map(line => creditLine(line.artist, line.title));
  const pad = Math.min(MAX_PAD, credits.reduce((wide, c) => Math.max(wide, c.length), 0));
  const plural = listing.trackCount === 1 ? 'track' : 'tracks';

  const header = [
    listing.discTitle || 'Mix CD',
    `${listing.trackCount} ${plural} · ${listing.totalDuration} · ${burnedOn.toLocaleDateString()}`,
    '',
  ];

  const body = listing.lines.map((line, index) => {
    const number = `${String(line.number).padStart(numberWidth, ' ')}.`;
    const credit = credits[index].padEnd(pad, ' ');
    return `${number}  ${credit}  ${line.duration.padStart(5, ' ')}`.trimEnd();
  });

  return [...header, ...body, '', `Total  ${listing.totalDuration}`, ''].join('\n');
}

/**
 * A filename that will not surprise anyone's filesystem.
 *
 * Only the characters Windows actually forbids are stripped — spaces and
 * hyphens are ordinary in a disc title and removing them would mangle every
 * name that has one.
 */
export function listingFileName(discTitle: string): string {
  const cleaned = discTitle
    .replace(/[<>:"/\\|?*]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  return `${cleaned || 'Mix CD'} track listing.txt`;
}
