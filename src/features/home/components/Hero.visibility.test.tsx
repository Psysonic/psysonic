import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { latestIntersectionObserver, latestResizeObserver } from '@/test/mocks/browser';
import { sampleEmptyAlbum } from '@/test/mocks/subsonic';
import Hero from './Hero';

// Keep the observers for title fitting and cover loading out of the carousel test.
vi.mock('@/features/home/hooks/useHeroTitleFit', () => ({ useHeroTitleFit: () => {} }));
vi.mock('@/cover/useLibraryCoverRef', () => ({ useAlbumCoverRef: () => null }));

const albums = [
  { ...sampleEmptyAlbum, id: 'a', name: 'First album' },
  { ...sampleEmptyAlbum, id: 'b', name: 'Second album' },
];

function resizeHero(height: number) {
  const hero = screen.getByRole('banner');
  const resize = latestResizeObserver()!;
  expect(resize.observe).toHaveBeenCalledWith(hero);
  Object.defineProperty(hero, 'clientHeight', { configurable: true, value: height });
  act(() => resize.emit());
  const observer = latestIntersectionObserver()!;
  expect(observer.observe).toHaveBeenCalledWith(hero);
  return observer;
}

function advance(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
}

describe('Hero visibility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    renderWithProviders(<Hero albums={albums} />);
  });

  afterEach(() => { vi.useRealTimers(); });

  it('advances after ten seconds with exactly 56 pixels visible', () => {
    const observer = resizeHero(400);
    act(() => observer.emit(true, 56 / 400));
    advance(9_999);
    expect(screen.getByRole('heading')).toHaveTextContent('First album');
    advance(1);
    expect(screen.getByRole('heading')).toHaveTextContent('Second album');
  });

  it.each([
    { state: 'offscreen', intersecting: false, ratio: 0 },
    { state: 'below the visibility threshold', intersecting: true, ratio: 55 / 400 },
  ])('pauses when $state and resumes on re-entry', ({ intersecting, ratio }) => {
    const observer = resizeHero(400);
    act(() => observer.emit(true));
    advance(10_000);
    expect(screen.getByRole('heading')).toHaveTextContent('Second album');
    act(() => observer.emit(intersecting, ratio));
    advance(10_000);
    expect(screen.getByRole('heading')).toHaveTextContent('Second album');
    act(() => observer.emit(true));
    advance(10_000);
    expect(screen.getByRole('heading')).toHaveTextContent('First album');
  });

  it('replaces the observer on resize and caps the threshold at 20 percent', () => {
    const first = resizeHero(400);
    expect(first.thresholds).toEqual([56 / 400]);
    const second = resizeHero(200);
    expect(first.disconnect).toHaveBeenCalledOnce();
    expect(second).not.toBe(first);
    expect(second.thresholds).toEqual([0.2]);
  });
});
