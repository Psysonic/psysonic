import type { ResumePoint } from '@/features/resume/store/resumePointsStore';

/** Share of the list already heard: whole tracks before the point plus the current one so far. */
export function resumeProgress(point: Pick<ResumePoint, 'trackIndex' | 'trackCount' | 'positionSec' | 'durationSec'>): number {
  if (point.trackCount <= 0) return 0;
  const within = point.durationSec > 0 ? Math.min(1, point.positionSec / point.durationSec) : 0;
  return Math.max(0, Math.min(1, (point.trackIndex + within) / point.trackCount));
}
