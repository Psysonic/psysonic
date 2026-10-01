import { useTranslation } from 'react-i18next';
import { AudioLines } from 'lucide-react';
import { usePlayerStore } from '@/features/playback/store/playerStore';

interface Props {
  /** `cover`: corner of a square cover · `round`: bottom centre of a round avatar · `inline`: in a text row. */
  variant?: 'cover' | 'round' | 'inline';
}

/**
 * Marker for the card or row that belongs to what is playing. It shows the
 * same static `AudioLines` icon the tracklists use; only on Windows and macOS,
 * while playback runs and without a reduced-motion preference, CSS swaps it for
 * moving bars (now-playing-marker.css). Linux keeps the icon: animated bars
 * are what pegged WebKitGTK without compositing in the tracklists.
 */
export function NowPlayingMarker({ variant = 'cover' }: Props) {
  const { t } = useTranslation();
  const isPlaying = usePlayerStore(s => s.isPlaying);
  return (
    <span
      className={`now-playing-marker now-playing-marker--${variant}`}
      data-playing={isPlaying ? 'true' : 'false'}
    >
      <AudioLines className="now-playing-marker-icon" size={14} aria-hidden="true" />
      <span className="now-playing-marker-bars" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="visually-hidden">{t('sidebar.nowPlaying')}</span>
    </span>
  );
}
