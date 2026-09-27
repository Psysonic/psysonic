import { afterEach, describe, expect, it } from 'vitest';
import { fitHeroTitle, HERO_TITLE_CLAMPED_CLASS, HERO_TITLE_MIN_PX } from './fitHeroTitle';

/**
 * jsdom has no layout, so the column height is modelled from the title's font
 * size: `other` px for eyebrow/artist/meta/buttons plus `lines(size)` lines of
 * 1.2 × size. The content box is 360 px with 32 px padding (296 px usable),
 * like the real hero.
 */
function hero(baseFontPx: number, lines: (sizePx: number) => number, other = 140) {
  const content = document.createElement('div');
  content.style.paddingTop = '32px';
  content.style.paddingBottom = '32px';
  Object.defineProperty(content, 'clientHeight', { get: () => 360 });
  const text = document.createElement('div');
  const title = document.createElement('h2');
  title.className = 'hero-title';
  const style = document.createElement('style');
  style.textContent = `.hero-title { font-size: ${baseFontPx}px; }`;
  document.head.appendChild(style);
  const sizeOf = () => parseFloat(getComputedStyle(title).fontSize);
  const model = { lines };
  Object.defineProperty(text, 'offsetHeight', {
    get: () => other + model.lines(sizeOf()) * sizeOf() * 1.2,
  });
  text.appendChild(title);
  content.appendChild(text);
  document.body.appendChild(content);
  return { content, text, title, model };
}

afterEach(() => {
  document.body.innerHTML = '';
  document.head.querySelectorAll('style').forEach(s => s.remove());
});

describe('fitHeroTitle', () => {
  it('leaves a title that fits at the stylesheet size alone', () => {
    const { content, text, title } = hero(36, () => 3);
    expect(fitHeroTitle(content, text, title)).toEqual({ fontSizePx: null, clamped: false });
    expect(title.style.fontSize).toBe('');
  });

  it('shrinks in steps to the largest size that fits', () => {
    // 6 lines at 36 px, 5 at ≤32 px, 4 at ≤28 px: 4 × 28 × 1.2 = 134.4 → fits (274.4 ≤ 296).
    const { content, text, title } = hero(36, size => (size > 32 ? 6 : size > 28 ? 5 : 4));
    expect(fitHeroTitle(content, text, title)).toEqual({ fontSizePx: 28, clamped: false });
    expect(title.style.fontSize).toBe('28px');
    expect(title.classList.contains(HERO_TITLE_CLAMPED_CLASS)).toBe(false);
  });

  it('clamps the lines at the minimum size when nothing fits', () => {
    const { content, text, title } = hero(36, () => 12);
    expect(fitHeroTitle(content, text, title)).toEqual({ fontSizePx: HERO_TITLE_MIN_PX, clamped: true });
    expect(title.style.fontSize).toBe(`${HERO_TITLE_MIN_PX}px`);
    expect(title.classList.contains(HERO_TITLE_CLAMPED_CLASS)).toBe(true);
  });

  it('starts from the stylesheet size again on every fit', () => {
    const { content, text, title, model } = hero(36, () => 12);
    fitHeroTitle(content, text, title);
    // Next album: short title that fits at full size.
    model.lines = () => 1;
    expect(fitHeroTitle(content, text, title)).toEqual({ fontSizePx: null, clamped: false });
    expect(title.style.fontSize).toBe('');
    expect(title.classList.contains(HERO_TITLE_CLAMPED_CLASS)).toBe(false);
  });
});
