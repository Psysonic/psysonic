/**
 * Where each track sits on the disc, in degrees, and the paths that draw it.
 *
 * The queue always fills the circle. It was drawn to the disc's capacity at
 * first, so a 39-minute queue on an 80-minute disc filled half the ring — but
 * the empty remainder read as a fault rather than as headroom, and the burn
 * fill no longer meant a plain 0-100%. How much room is left is stated in
 * words instead, in the hub and the drive bar.
 *
 * The scale is the PROGRAM AREA, counted from zero — the same space every
 * backend reports `sectorsDone` in. It used to include the 150-sector pregap,
 * to match the disc-absolute `arc.startSector` that `layoutDisc` produces, and
 * the two then disagreed by exactly 150 for the whole burn: every tick landed
 * a frame late and the last track never reached the end of its own wedge.
 *
 * Everything in this file lives in that program-area space, `capacityAngle`
 * included. Nothing here may be compared against `arc.startSector` or against
 * a raw `capacitySectors`, both of which count from the front of the disc and
 * so carry the pregap. The pregap is a hundred and fifty sectors — two seconds
 * of silence — and on an eighty-minute queue that is more than a tenth of a
 * degree of ring, which is the difference between a capacity marker that cuts
 * the wedge it belongs to and one that sits beside it.
 */
import { PREGAP_SECTORS, type DiscArc, type DiscLayout } from '@/features/burner/utils/capacity';

/** A track's slice of the ring. */
export interface DiscSlice {
  key: string;
  /** 0-based, matching the track list. */
  index: number;
  startAngle: number;
  endAngle: number;
  /** Program-area sector this track starts at — the drive's own counting. */
  startSector: number;
  sectors: number;
  color: string;
}

export interface DiscGeometry {
  slices: DiscSlice[];
  /** Degrees the burn has reached, 0 when nothing is written. */
  progressAngle: number;
  /** Sectors the whole circle represents — the queue's program area. */
  scaleSectors: number;
}

/**
 * Lay the queue out.
 *
 * `sectorsDone` is only meaningful once the laser is on; callers pass 0 for
 * every other phase, which is what keeps an unlit ring unlit.
 */
export function discGeometry(
  arcs: DiscArc[],
  colorAt: (index: number) => string,
  options: { sectorsDone: number },
): DiscGeometry {
  const { sectorsDone } = options;

  const queueSectors = arcs.reduce((total, arc) => total + arc.sectors, 0);
  const scaleSectors = Math.max(1, queueSectors);
  const degreesPerSector = 360 / scaleSectors;

  // Walked rather than taken from `arc.startSector`, which is disc-absolute.
  // This walk is the drive's space, so the angles and the sector positions the
  // write phase reports cannot disagree.
  let cursor = 0;
  const slices = arcs.map((arc, index) => {
    const startSector = cursor;
    const startAngle = cursor * degreesPerSector;
    cursor += arc.sectors;
    return {
      key: arc.key,
      index,
      startAngle,
      endAngle: Math.min(360, cursor * degreesPerSector),
      startSector,
      sectors: arc.sectors,
      color: colorAt(index),
    };
  });

  return {
    slices,
    progressAngle: Math.max(0, Math.min(360, sectorsDone * degreesPerSector)),
    scaleSectors,
  };
}

/**
 * A laid-out queue's length in the program-area sectors this file counts in.
 *
 * The one place the two sector spaces meet. `layoutDisc` walks from the front
 * of the disc, so its `totalSectors` carries the 150-sector pregap that sits
 * ahead of track one; everything here counts from zero instead, and the whole
 * difference between the two is that pregap.
 *
 * A named function rather than a subtraction at the call site because it spent
 * its life inline in `BurnDisc`, where the conversion was invisible: dropping
 * it and reversing its sign both draw a ring that looks entirely plausible,
 * and the capacity marker simply sits a fraction of a degree out — far enough
 * to land on the wrong side of a wedge boundary and blame the wrong track.
 */
export function programAreaSectors(layout: Pick<DiscLayout, 'totalSectors'>): number {
  return layout.totalSectors - PREGAP_SECTORS;
}

/**
 * Where the loaded disc's edge falls on a ring the queue has overrun, in
 * degrees, or `null` while the queue still fits.
 *
 * The ring is the queue, so a queue too long for the disc runs past the disc's
 * own capacity somewhere before the twelve o'clock line comes back round. That
 * crossing is the one thing the arithmetic knows and the page has never shown:
 * 'over capacity by 4:12' says how much has to go, and this says which tracks
 * it is.
 *
 * Both arguments are program-area counts. The caller converts the queue with
 * `programAreaSectors` before handing it over and the capacity has its own
 * pregap taken off here, because a marker measured in one space and drawn in
 * another is exactly the bug this file's header records.
 */
export function capacityAngle(
  queueProgramSectors: number,
  capacitySectors: number,
): number | null {
  const room = capacitySectors - PREGAP_SECTORS;
  if (queueProgramSectors <= 0 || room <= 0 || room >= queueProgramSectors) return null;
  // Held a hair short of a full turn: a queue one sector over capacity would
  // otherwise put the marker at 360 and leave the wash behind it zero degrees
  // wide, which draws as nothing at all — the one case where the page would
  // stay silent is the one closest to fitting.
  return Math.min(359.99, Math.max(0, (360 * room) / queueProgramSectors));
}

/**
 * The track under the write head, or `null` when nothing is being written.
 *
 * Compared against the slice angles rather than sector counts so it can never
 * disagree with what is drawn.
 */
export function sliceAtAngle(slices: DiscSlice[], angle: number): DiscSlice | null {
  if (angle <= 0) return null;
  return slices.find(slice => angle >= slice.startAngle && angle < slice.endAngle) ?? null;
}

/**
 * How many tracks are wholly behind the head.
 *
 * Takes the drive's own program-area count, so it needs no correction: the
 * slices are walked in that same space.
 */
export function tracksBefore(slices: DiscSlice[], sectorsDone: number): number {
  if (sectorsDone <= 0) return 0;
  return slices.filter(slice => sectorsDone >= slice.startSector + slice.sectors).length;
}

/**
 * Hairline between one wedge and the next, in degrees.
 *
 * Cut off the end of each wedge rather than drawn as a separate layer, so the
 * gaps land on the track boundaries instead of at some fixed interval that
 * agrees with the running order only by accident.
 */
const WEDGE_GAP_DEG = 0.34;

/** How much of a wedge the gap may eat, so a short track is never all gap. */
const MAX_GAP_SHARE = 0.25;

/** The drawn end of a wedge — its true end, less the hairline. */
export function wedgeEnd(slice: { startAngle: number; endAngle: number }): number {
  const span = slice.endAngle - slice.startAngle;
  return slice.endAngle - Math.min(WEDGE_GAP_DEG, span * MAX_GAP_SHARE);
}

/** A point on the ring. 0deg is twelve o'clock and angles run clockwise. */
export function polar(radius: number, degrees: number): [number, number] {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return [50 + radius * Math.cos(radians), 50 + radius * Math.sin(radians)];
}

/**
 * An SVG path for one annular sector, in a 100x100 viewBox centred on 50,50.
 *
 * Real geometry rather than a `conic-gradient` colour stop. A gradient cannot
 * stroke an edge, so every wedge boundary was an aliased hard cut and the gaps
 * were holes punched through to the black beneath — which is precisely what
 * made the ring look cheap.
 */
export function annularSector(
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  // A wedge narrower than this renders as nothing at all; the floor keeps a
  // four-second track visible rather than silently absent.
  const end = endAngle - startAngle < 0.02 ? startAngle + 0.02 : endAngle;
  const large = end - startAngle > 180 ? 1 : 0;
  const [ox0, oy0] = polar(outerRadius, startAngle);
  const [ox1, oy1] = polar(outerRadius, end);
  const [ix1, iy1] = polar(innerRadius, end);
  const [ix0, iy0] = polar(innerRadius, startAngle);
  const n = (value: number) => value.toFixed(3);
  return (
    `M${n(ox0)} ${n(oy0)}` +
    `A${outerRadius} ${outerRadius} 0 ${large} 1 ${n(ox1)} ${n(oy1)}` +
    `L${n(ix1)} ${n(iy1)}` +
    `A${innerRadius} ${innerRadius} 0 ${large} 0 ${n(ix0)} ${n(iy0)}Z`
  );
}
