import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { showToast } from '@/lib/dom/toast';
import { canonicalQueueServerKey } from '@/lib/server/serverIndexKey';
import { resumePointKey, useResumePointsStore, type ResumePoint } from '@/features/resume/store/resumePointsStore';
import { useResumePointsForServers } from '@/features/resume/hooks/useResumePoints';
import ResumeCard from '@/features/resume/components/ResumeCard';

interface Props {
  serverIds: readonly string[];
  artworkSize: number;
  disableArtwork?: boolean;
}

/** How long the undo stays offered after removing or clearing. */
export const RESUME_UNDO_MS = 6000;

/**
 * Home rail of unfinished albums and playlists. It reads only the stored
 * points (at most ten per server): no request, no index query, and it
 * re-renders when a point is written, not while a track plays.
 */
export function ContinueListeningRail({ serverIds, artworkSize, disableArtwork = false }: Props) {
  const { t } = useTranslation();
  const points = useResumePointsForServers(serverIds);

  const offerUndo = useCallback((text: string, removed: ResumePoint[]) => {
    showToast(text, RESUME_UNDO_MS, 'info', {
      label: t('resume.undo'),
      onClick: () => useResumePointsStore.getState().restorePoints(removed),
    });
  }, [t]);

  const removeOne = useCallback((point: ResumePoint) => {
    useResumePointsStore.getState().removePoint(point);
    const name = point.name || t(point.kind === 'album' ? 'resume.untitledAlbum' : 'resume.untitledPlaylist');
    offerUndo(t('resume.removed', { name }), [point]);
  }, [offerUndo, t]);

  const clearAll = useCallback(() => {
    const serverKeys = serverIds.map(id => canonicalQueueServerKey(id));
    const removed = useResumePointsStore.getState().clearServers(serverKeys);
    if (removed.length > 0) offerUndo(t('resume.cleared'), removed);
  }, [offerUndo, serverIds, t]);

  if (points.length === 0) return null;

  return (
    <section className="album-row-section resume-rail" aria-label={t('resume.title')}>
      <div className="album-row-header">
        <h2 className="section-title" style={{ marginBottom: 0 }}>{t('resume.title')}</h2>
        <div className="album-row-nav">
          <button
            type="button"
            className="btn btn-ghost btn-sm resume-rail-clear"
            aria-label={t('resume.clearLabel')}
            onClick={clearAll}
          >
            <Trash2 size={14} />
            {t('resume.clear')}
          </button>
        </div>
      </div>
      <div className="album-grid-wrapper">
        <div className="album-grid">
          {points.map(point => (
            <ResumeCard
              key={resumePointKey(point)}
              point={point}
              displayCssPx={artworkSize}
              disableArtwork={disableArtwork}
              onRemove={removeOne}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
