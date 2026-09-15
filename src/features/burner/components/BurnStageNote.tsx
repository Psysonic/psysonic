import { useTranslation } from 'react-i18next';
import type { BurnStage } from '@/features/burner/utils/burnStage';
import type { BurnJobState } from '@/features/burner/store/burnJobStore';
import { classifyBurnFailure, discVerdict } from '@/features/burner/utils/burnOutcome';
import { formatClock } from '@/features/burner/utils/burnTiming';
import { formatDuration } from '@/features/burner/utils/capacity';

export interface BurnStageNoteProps {
  stage: BurnStage;
  /** Why the queue cannot be burned, already translated, or null. */
  blocker: string | null;
  pastRedBook74: boolean;
  job: Pick<BurnJobState, 'status' | 'testWrite' | 'sectorsDone' | 'error' | 'tracksWritten'>;
  /** How long the burn actually took, captured before the timer was cleared. */
  finalElapsedSec: number | null;
  /** The queue's runtime, for the written-disc line. */
  queueSeconds: number;
  /** The id the abort button points at with aria-describedby. */
  warningId: string;
}

/**
 * The one line under the transport, at a fixed height.
 *
 * Fixed because everything it can say arrives and leaves at moments when the
 * disc must not move: a blocker appearing as a track is added, the commitment
 * warning as the laser starts, the outcome as it stops. A slot that grows and
 * shrinks would resize the stage above it, and the disc is sized from what the
 * stage has left.
 */
export default function BurnStageNote({
  stage, blocker, pastRedBook74, job, finalElapsedSec, queueSeconds, warningId,
}: BurnStageNoteProps) {
  const { t } = useTranslation();

  if (stage === 'building') {
    if (blocker) return <p className="burner-blocker">{blocker}</p>;
    if (pastRedBook74) return <p className="burner-advisory">{t('burner.past74')}</p>;
    return <p className="burner-stage-note-empty" aria-hidden="true" />;
  }

  if (stage === 'preparing') {
    // Worth saying plainly: this is the only part of a burn that can be
    // abandoned for free, and the moment it stops being true is invisible.
    return <p className="burner-advisory">{t('burner.prepareStopFree')}</p>;
  }

  if (stage === 'committing') {
    return (
      <p className="burner-blocker" id={warningId}>{t('burner.cancelSpoilsDisc')}</p>
    );
  }

  // ── Settled: what happened, and what the disc is now ──────────────────
  const verdict = discVerdict(job);
  const hint = job.error ? classifyBurnFailure(job.error) : null;

  const headline = job.status === 'done'
    ? job.testWrite
      ? t('burner.outcomeRehearsed')
      : t('burner.outcomeWritten', {
        count: job.tracksWritten,
        duration: formatDuration(queueSeconds),
        elapsed: formatClock(finalElapsedSec),
      })
    : job.status === 'failed'
      ? t('burner.outcomeFailed')
      : t('burner.outcomeCancelled');

  return (
    <div className={`burner-outcome${job.status === 'done' ? ' is-good' : ' is-bad'}`}>
      <p className="burner-outcome-line">{headline}</p>

      {/* The disc's own state, said separately from the job's. A rehearsal can
          fail and leave a perfectly good blank; a real burn can be stopped one
          sector in and leave a coaster. */}
      {verdict === 'spoiled' && <p className="burner-outcome-disc">{t('burner.discSpoiled')}</p>}
      {verdict === 'blank' && job.status !== 'done' && (
        <p className="burner-outcome-disc">{t('burner.discBlank')}</p>
      )}

      {hint && <p className="burner-outcome-disc">{t(hint)}</p>}

      {/* Never ellipsised. A drive's own words are the most useful thing on
          the page when a burn fails, and they are often long. */}
      {job.error && <pre className="burner-outcome-detail">{job.error}</pre>}
    </div>
  );
}
