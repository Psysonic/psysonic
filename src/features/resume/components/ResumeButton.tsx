import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StepForward } from 'lucide-react';
import { formatTrackTime } from '@/lib/format/formatDuration';
import { showToast } from '@/lib/dom/toast';
import { tooltipAttrs } from '@/ui/tooltipAttrs';
import { useResumePoint } from '@/features/resume/hooks/useResumePoints';
import { resumeFromPoint } from '@/features/resume/utils/resumePlayback';
import type { ResumeKind } from '@/features/resume/store/resumePointsStore';

interface Props {
  kind: ResumeKind;
  id: string | undefined;
  serverId: string | undefined;
  className?: string;
  /** Icon only, for the compact mobile action row. */
  iconOnly?: boolean;
}

/** "Resume · 4 · 2:13" next to Play, only while the list has a resume point. */
export function ResumeButton({ kind, id, serverId, className = 'btn btn-surface', iconOnly = false }: Props) {
  const { t } = useTranslation();
  const point = useResumePoint(kind, id, serverId);
  const [busy, setBusy] = useState(false);
  if (!point) return null;

  const track = point.trackIndex + 1;
  const time = formatTrackTime(point.positionSec);
  const tooltip = t('resume.tooltip', { track, time });
  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    const started = await resumeFromPoint(point);
    setBusy(false);
    if (!started) showToast(t('resume.unavailable'), 4000, 'error');
  };

  return (
    <button
      type="button"
      className={className}
      onClick={() => void onClick()}
      disabled={busy}
      {...tooltipAttrs(tooltip)}
    >
      <StepForward size={iconOnly ? 20 : 15} />
      {!iconOnly && (
        <span className="compact-btn-label">{t('resume.button', { track, time })}</span>
      )}
    </button>
  );
}
