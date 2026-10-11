import { useTranslation } from 'react-i18next';
import type { PlaySessionDayDetail } from '@/lib/api/library';
import { formatPlayerStatsListenedSec } from '@/lib/format/formatHumanDuration';
import ExplicitBadge from '@/ui/ExplicitBadge';
import { dayTrackKey, useExplicitDayTrackKeys } from '@/features/stats/hooks/useExplicitDayTrackKeys';

type Props = {
  detail: PlaySessionDayDetail;
};

export default function PlayerStatsDayTracks({ detail }: Props) {
  const { t } = useTranslation();
  const explicitKeys = useExplicitDayTrackKeys(detail.tracks);

  return (
    <ul className="player-stats-day-tracks">
      {detail.tracks.map(tr => (
        <li key={`${tr.serverId}:${tr.trackId}:${tr.startedAtMs}`}>
          <div className="player-stats-day-track-title">
            {tr.title}
            <ExplicitBadge status={explicitKeys.has(dayTrackKey(tr)) ? 'explicit' : undefined} />
          </div>
          <div className="player-stats-day-track-meta">
            {tr.artist ?? '—'}
            {' · '}
            {formatPlayerStatsListenedSec(tr.listenedSec)}
            {' · '}
            {tr.completion === 'full'
              ? t('statistics.completionFull')
              : t('statistics.completionPartial')}
          </div>
        </li>
      ))}
    </ul>
  );
}
