import { useLayoutEffect, type RefObject } from 'react';
import { fitHeroTitle } from '@/features/home/utils/fitHeroTitle';

/**
 * Re-fits the hero title whenever the album (title) changes, the hero is
 * resized, or the web fonts finish loading — each can change how many lines
 * the title wraps to. Works on the DOM directly, so a fit never re-renders.
 */
export function useHeroTitleFit(heroRef: RefObject<HTMLElement | null>, fitKey: string | undefined): void {
  useLayoutEffect(() => {
    const hero = heroRef.current;
    if (!hero || !fitKey) return;

    let frame: number | null = null;
    const run = () => {
      frame = null;
      const content = hero.querySelector<HTMLElement>('.hero-content');
      const text = hero.querySelector<HTMLElement>('.hero-text');
      const titleEl = hero.querySelector<HTMLElement>('.hero-title');
      if (content && text && titleEl) fitHeroTitle(content, text, titleEl);
    };
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(run);
    };

    run();
    let cancelled = false;
    void document.fonts?.ready.then(() => { if (!cancelled) schedule(); });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(hero);
    return () => {
      cancelled = true;
      observer?.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [heroRef, fitKey]);
}
