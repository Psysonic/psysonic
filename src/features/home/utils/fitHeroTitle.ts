/** Smallest title size the hero shrinks to before it clamps lines instead. */
export const HERO_TITLE_MIN_PX = 20;
const HERO_TITLE_STEP_PX = 2;
export const HERO_TITLE_CLAMPED_CLASS = 'hero-title--clamped';

export interface HeroTitleFitResult {
  /** Inline size applied to the title, or null when the stylesheet size fits. */
  fontSizePx: number | null;
  clamped: boolean;
}

/**
 * The hero has a fixed height and grows its text column upward, so a long album
 * title pushes the eyebrow and the title itself out of the top edge. Shrink the
 * title in small steps until the column fits the content box; at the minimum
 * size, cap the title's lines instead so nothing is ever cut off.
 */
export function fitHeroTitle(
  content: HTMLElement,
  text: HTMLElement,
  title: HTMLElement,
): HeroTitleFitResult {
  title.style.fontSize = '';
  title.classList.remove(HERO_TITLE_CLAMPED_CLASS);

  const box = getComputedStyle(content);
  const available = content.clientHeight - parseFloat(box.paddingTop) - parseFloat(box.paddingBottom);
  const fits = () => text.offsetHeight <= available;
  if (available <= 0 || fits()) return { fontSizePx: null, clamped: false };

  const base = parseFloat(getComputedStyle(title).fontSize);
  let size = Math.floor(base) - HERO_TITLE_STEP_PX;
  for (; size >= HERO_TITLE_MIN_PX; size -= HERO_TITLE_STEP_PX) {
    title.style.fontSize = `${size}px`;
    if (fits()) return { fontSizePx: size, clamped: false };
  }
  title.style.fontSize = `${HERO_TITLE_MIN_PX}px`;
  title.classList.add(HERO_TITLE_CLAMPED_CLASS);
  return { fontSizePx: HERO_TITLE_MIN_PX, clamped: true };
}
