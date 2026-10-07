import { useTranslation } from 'react-i18next';
import { resumePointKey } from '@/features/resume/store/resumePointsStore';
import { useResumePointsForServers } from '@/features/resume/hooks/useResumePoints';
import ResumeCard from '@/features/resume/components/ResumeCard';

interface Props {
  serverIds: readonly string[];
  artworkSize: number;
  disableArtwork?: boolean;
}

/**
 * Home rail of unfinished albums and playlists. It reads only the stored
 * points (at most ten per server): no request, no index query, and it
 * re-renders when a point is written, not while a track plays.
 */
export function ContinueListeningRail({ serverIds, artworkSize, disableArtwork = false }: Props) {
  const { t } = useTranslation();
  const points = useResumePointsForServers(serverIds);
  if (points.length === 0) return null;

  return (
    <section className="album-row-section resume-rail" aria-label={t('resume.title')}>
      <div className="album-row-header">
        <h2 className="section-title" style={{ marginBottom: 0 }}>{t('resume.title')}</h2>
      </div>
      <div className="album-grid-wrapper">
        <div className="album-grid">
          {points.map(point => (
            <ResumeCard
              key={resumePointKey(point)}
              point={point}
              displayCssPx={artworkSize}
              disableArtwork={disableArtwork}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
