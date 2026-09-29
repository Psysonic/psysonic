import { useTranslation } from 'react-i18next';
import { SIDE_MIN_PX } from '@/features/burner/utils/burnStage';
import type { BurnSeamHandleProps } from '@/features/burner/hooks/useBurnerSplit';

export interface BurnSeamProps {
  /** Everything the drag, the keyboard and the reset need — see `useBurnerSplit`. */
  seamProps: BurnSeamHandleProps;
  /** The running order's width, for the value the assistive label reads out. */
  width: number;
  /** As wide as the running order can go here, which the page's own width sets. */
  effectiveMax: number;
  dragging: boolean;
}

/**
 * The gutter between the disc and the running order.
 *
 * Presentation only: `useBurnerSplit` owns the number and every handler, so the
 * two cannot drift apart. It carries no children — the hairline and the grip
 * are pseudo-elements, which keeps the whole 24px hit area a single target
 * rather than something a cursor can fall between.
 *
 * It is a real `separator` with a value, so the width is adjustable from the
 * keyboard as well as the mouse. A gutter that only answers to a drag is one
 * more thing on this page that a keyboard cannot reach.
 */
export default function BurnSeam({ seamProps, width, effectiveMax, dragging }: BurnSeamProps) {
  const { t } = useTranslation();
  const px = Math.round(width);

  return (
    <div
      {...seamProps}
      className={dragging ? 'burner-seam is-dragging' : 'burner-seam'}
      aria-label={t('burner.seamLabel')}
      aria-valuenow={px}
      aria-valuemin={SIDE_MIN_PX}
      aria-valuemax={Math.round(effectiveMax)}
      // Pixels read as pixels. Without this a screen reader announces a bare
      // number against a range whose units it has no way to know.
      aria-valuetext={t('burner.seamValue', { px })}
    />
  );
}
