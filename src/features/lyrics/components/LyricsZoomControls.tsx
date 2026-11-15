import { useTranslation } from 'react-i18next';
import type { RefCallback } from 'react';

interface Props {
  scale: number;
  resetZoom: () => void;
  badgeRef: RefCallback<HTMLButtonElement>;
  showSizeIndicator: boolean;
}

/** Presentation only: the surface owns the shared appearance subscription. */
export function LyricsZoomControls({ scale, resetZoom, badgeRef, showSizeIndicator }: Props) {
  const { t } = useTranslation();
  if (!showSizeIndicator) return null;
  const hint = t('settings.lyricsZoomKeyboardHint');
  return (
    <button type="button" className="lyrics-zoom-badge" ref={badgeRef} onClick={resetZoom}
      aria-label={`${t('settings.lyricsSize')}: ${Math.round(scale * 100)}% · ${t('settings.lyricsSizeReset')}`}
      title={hint}>
      {Math.round(scale * 100)}%
    </button>
  );
}
