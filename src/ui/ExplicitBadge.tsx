import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isExplicit } from '@/lib/media/explicitStatus';

interface Props {
  /** OpenSubsonic `explicitStatus` of the track (or album). */
  status?: string;
}

/**
 * "E" after a title that wraps (page headings): sits inline after the last
 * word, its bottom edge on the text baseline. Renders only for explicit items;
 * whether it is visible is the `html[data-explicit-badges]` setting, so a
 * tracklist row costs nothing extra unless its track is explicit.
 */
export default function ExplicitBadge({ status }: Props) {
  if (!isExplicit({ explicitStatus: status })) return null;
  return <ExplicitBadgeMark />;
}

/**
 * A single-line title (ellipsis) with its badge beside it, bottoms aligned on
 * the baseline. The title shrinks and truncates; the badge never does. Without
 * an explicit status the title renders exactly as before, unwrapped.
 */
export function ExplicitTitle({ status, children }: Props & { children: ReactNode }) {
  if (!isExplicit({ explicitStatus: status })) return <>{children}</>;
  return (
    <span className="explicit-title">
      {children}
      <ExplicitBadgeMark />
    </span>
  );
}

function ExplicitBadgeMark() {
  const { t } = useTranslation();
  const label = t('common.explicit');
  // The letter is drawn by CSS: with no text of its own, the box's baseline is
  // its bottom edge, which is what lines it up with the title's baseline.
  return <span className="explicit-badge" role="img" aria-label={label} data-tooltip={label} />;
}
