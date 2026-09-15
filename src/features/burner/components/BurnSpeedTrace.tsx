import { useTranslation } from 'react-i18next';

export interface BurnSpeedTraceProps {
  /** Recent rates in sectors per second, oldest first. */
  history: number[];
}

/** Sectors per second at 1×, from Red Book. */
const SECTORS_PER_SECOND = 75;

/** Below this share of the running median, a sample is drawn as a dip. */
const DIP_SHARE = 0.6;

/** The viewBox. Wide and short: this is a sparkline, not a chart. */
const W = 100;
const H = 28;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * How the write speed has actually behaved, as a line.
 *
 * A drive that starts at 16× and drops to 8× halfway through a disc is doing
 * something worth seeing, and a single number cannot show it — by the time you
 * read "8×" the interesting part has already happened. The dips are shaded
 * because that is the shape people are looking for: a burn that sagged is a
 * burn worth watching, and on a bad disc it is the first sign.
 *
 * Hand-rolled rather than a charting library. It is one polyline over sixty
 * numbers, and the alternative is a dependency for a 100×28 box.
 */
export default function BurnSpeedTrace({ history }: BurnSpeedTraceProps) {
  const { t } = useTranslation();

  // Two samples is the first moment there is a line rather than a dot.
  if (history.length < 2) return null;

  const speeds = history.map(rate => rate / SECTORS_PER_SECOND);
  const now = speeds[speeds.length - 1];
  const low = Math.min(...speeds);
  const mid = median(speeds);

  // Scaled to the run's own range rather than to the drive's rated maximum:
  // the question is whether this burn is holding steady, not how it compares
  // to a number on the box.
  const top = Math.max(...speeds);
  const floor = Math.min(low, mid * DIP_SHARE);
  const span = Math.max(0.001, top - floor);

  const x = (i: number) => (i / (speeds.length - 1)) * W;
  const y = (speed: number) => H - ((speed - floor) / span) * (H - 2) - 1;

  const line = speeds.map((speed, i) => `${x(i).toFixed(2)},${y(speed).toFixed(2)}`).join(' ');

  // Closed back along the bottom so the sag under the line can be filled.
  const dipped = speeds.some(speed => speed < mid * DIP_SHARE);
  const area = `${line} ${W},${H} 0,${H}`;

  return (
    <svg
      className="burn-speed-trace"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={t('burner.speedTraceLabel', { now: now.toFixed(1), low: low.toFixed(1) })}
    >
      {dipped && <polygon className="burn-speed-trace-dip" points={area} />}
      <polyline className="burn-speed-trace-line" points={line} />
    </svg>
  );
}
