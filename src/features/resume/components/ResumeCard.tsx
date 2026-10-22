import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StepForward } from 'lucide-react';
import { CoverArtImage } from '@/cover/CoverArtImage';
import { useTrackCoverRef } from '@/cover/useLibraryCoverRef';
import { coverServerScopeForServerId } from '@/cover/serverScope';
import { formatTrackTime } from '@/lib/format/formatDuration';
import { showToast } from '@/lib/dom/toast';
import { resumeFromPoint } from '@/features/resume/utils/resumePlayback';
import { resumeProgress } from '@/features/resume/utils/resumeProgress';
import type { ResumePoint } from '@/features/resume/store/resumePointsStore';

interface Props {
  point: ResumePoint;
  displayCssPx: number;
  disableArtwork?: boolean;
}

/**
 * One unfinished album or playlist on Home. Everything it shows comes from the
 * stored point; the cover is the album art of the track playback stopped in.
 */
function ResumeCard({ point, displayCssPx, disableArtwork = false }: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const coverSong = useMemo(() => ({
    id: point.trackId,
    albumId: point.cover.albumId ?? '',
    coverArt: point.cover.coverArt,
    discNumber: point.cover.discNumber,
    serverId: point.serverId,
  }), [point.trackId, point.cover.albumId, point.cover.coverArt, point.cover.discNumber, point.serverId]);
  const coverScope = useMemo(() => coverServerScopeForServerId(point.serverId), [point.serverId]);
  const coverRef = useTrackCoverRef(coverSong, coverScope, { libraryResolve: false });

  const track = point.trackIndex + 1;
  const name = point.name || t(point.kind === 'album' ? 'resume.untitledAlbum' : 'resume.untitledPlaylist');
  const detail = t('resume.trackOf', { track, total: point.trackCount });
  const label = t('resume.cardLabel', { name, track, time: formatTrackTime(point.positionSec) });
  const progress = resumeProgress(point);

  const resume = async () => {
    if (busy) return;
    setBusy(true);
    const started = await resumeFromPoint(point);
    setBusy(false);
    if (!started) showToast(t('resume.unavailable'), 4000, 'error');
  };

  return (
    <div
      className="album-card card resume-card"
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-busy={busy || undefined}
      onClick={() => void resume()}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void resume(); } }}
    >
      <div className="album-card-cover">
        {!disableArtwork && coverRef ? (
          <CoverArtImage
            coverRef={coverRef}
            displayCssPx={displayCssPx}
            surface="dense"
            alt=""
            loading="eager"
            decoding="async"
          />
        ) : (
          <div className="album-card-cover-placeholder" aria-hidden="true">
            <StepForward size={40} />
          </div>
        )}
        <div className="resume-card-play" aria-hidden="true">
          <StepForward size={18} />
        </div>
        <div className="resume-card-progress" aria-hidden="true">
          <div className="resume-card-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </div>
      <div className="album-card-info">
        <p className="album-card-title truncate">{name}</p>
        <p className="album-card-artist truncate">{detail}</p>
      </div>
    </div>
  );
}

export default memo(ResumeCard);
