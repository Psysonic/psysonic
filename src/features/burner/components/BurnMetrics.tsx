import { useTranslation } from 'react-i18next';
import { formatClock, type BurnTiming } from '@/features/burner/utils/burnTiming';
import { formatBytes, formatDuration, sectorsToSeconds } from '@/features/burner/utils/capacity';
import type { BurnStage } from '@/features/burner/utils/burnStage';
import BurnSpeedTrace from '@/features/burner/components/BurnSpeedTrace';

export interface BurnMetricsProps {
  timing: BurnTiming;
  stage: BurnStage;
  /** The queue's own runtime, shown as the total before a burn starts. */
  queueSeconds: number;
  /** Room left on the loaded disc, in sectors. */
  remainingSectors: number;
  fits: boolean;
  /** How far past the end of the disc the queue runs, in sectors. */
  overSectors: number;
  /** Bytes still to download before anything can be rendered. */
  fetchBytes: number;
  tracksWritten: number;
  /** How long the burn took, captured before the timer was cleared. */
  finalElapsedSec: number | null;
}

interface Cell {
  key: string;
  label: string;
  value: string;
  tone?: 'warn';
}

/**
 * What is worth knowing, for whatever the page is doing.
 *
 * Every figure here is measured rather than predicted. Before the laser starts
 * there is no honest way to say how long a burn will take — "Automatic" means
 * the drive picks its own speed, and the Linux backend does not report speeds
 * at all — so nothing pretends to. Once writing begins the rate comes from the
 * sectors the drive actually reports, so a drive that slows down over the disc
 * is followed rather than averaged away.
 *
 * The box is a fixed height across all four stages. It sits in the same column
 * as the burn options and above nothing that may move, so a box that grew as
 * the stage changed would shift the page at exactly the moments it must not.
 *
 * This panel was twice proposed for deletion during the redesign and kept both
 * times: removing it takes TIME REMAINING off the screen during a five-minute
 * irreversible act, which is the one thing a person waiting actually wants.
 */
export default function BurnMetrics({
  timing, stage, queueSeconds, remainingSectors, fits, overSectors, fetchBytes,
  tracksWritten, finalElapsedSec,
}: BurnMetricsProps) {
  const { t } = useTranslation();

  const writing = stage === 'committing';

  const cells: Cell[] = writing
    ? [
      { key: 'elapsed', label: t('burner.metricElapsed'), value: formatClock(timing.elapsedSec) },
      { key: 'remaining', label: t('burner.metricRemaining'), value: formatClock(timing.remainingSec) },
      { key: 'total', label: t('burner.metricTotal'), value: formatClock(timing.totalSec) },
    ]
    : stage === 'preparing'
      ? [
        { key: 'runtime', label: t('burner.metricRuntime'), value: formatDuration(queueSeconds) },
        { key: 'fetch', label: t('burner.metricToFetch'), value: formatBytes(fetchBytes) },
      ]
      : stage === 'settled'
        ? [
          { key: 'written', label: t('burner.metricWritten'), value: String(tracksWritten) },
          { key: 'took', label: t('burner.metricTook'), value: formatClock(finalElapsedSec) },
        ]
        : [
          { key: 'runtime', label: t('burner.metricRuntime'), value: formatDuration(queueSeconds) },
          fits
            ? {
              key: 'headroom',
              label: t('burner.metricHeadroom'),
              value: formatDuration(sectorsToSeconds(remainingSectors)),
            }
            : {
              key: 'over',
              label: t('burner.metricOverBy'),
              value: formatDuration(sectorsToSeconds(overSectors)),
              tone: 'warn' as const,
            },
          // Only once there is something to fetch: an em dash here would be a
          // third of the panel spent saying nothing.
          ...(fetchBytes > 0
            ? [{ key: 'fetch', label: t('burner.metricToFetch'), value: formatBytes(fetchBytes) }]
            : []),
        ];

  return (
    <div className="burn-metrics">
      {cells.map(cell => (
        <div key={cell.key} className={cell.tone === 'warn' ? 'burn-metric is-warn' : 'burn-metric'}>
          <span>{cell.label}</span>
          <strong>{cell.value}</strong>
        </div>
      ))}

      {writing && timing.sectorsPerSec !== null && (
        <p className="burn-metric-rate">
          {t('burner.metricSpeed', { speed: (timing.sectorsPerSec / 75).toFixed(1) })}
        </p>
      )}

      {writing && <BurnSpeedTrace history={timing.history} />}
    </div>
  );
}
