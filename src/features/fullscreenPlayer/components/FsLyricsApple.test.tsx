import { act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseLyricsResult } from '@/features/lyrics/hooks/useLyrics';
import { useAuthStore } from '@/store/authStore';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { emitPlaybackSeek } from '@/features/playback/store/playbackProgress';
import * as smoothClock from '@/features/playback/store/playbackProgressSmooth';
import { resetAuthStore, resetPlayerStore } from '@/test/helpers/storeReset';
import { makeTrack } from '@/test/helpers/factories';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const result = vi.hoisted(() => ({ current: null as UseLyricsResult | null }));
vi.mock('@/features/lyrics/hooks/useLyrics', () => ({ useLyrics: () => result.current }));
import { FsLyricsApple } from './FsLyricsApple';
import { LyricsPane } from '@/features/lyrics';
import { FsLyricsRail } from './FsLyricsRail';

const track = makeTrack({ duration: 100 });
beforeEach(() => {
  resetAuthStore();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 423, 322));
  resetPlayerStore();
  usePlayerStore.setState({ currentTrack: track, currentTime: 0 });
  result.current = {
    syncedLines: [{ time: 0, text: 'original' }, { time: 10, text: 'fallback' }],
    wordLines: null, plainLyrics: null,
    pronunciationLines: [{ time: 0, text: 'pronunciation' }], pronunciationPlainLyrics: null,
    translations: [{ lang: 'en', lines: [{ time: 0, text: 'translation' }], plainLyrics: null }],
    source: 'server', loading: false, notFound: false, refresh: () => {},
  };
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('fullscreen Apple lyrics appearance (also used by Static and Prism)', () => {
  it.each(['fs-player', 'fsp', 'fsp2-player'])('removes the badge row in %s without disabling viewport zoom or player-chrome keys', hostClass => {
    useAuthStore.setState({ lyricsScale: 1.5, lyricsRomanizationEnabled: true, lyricsRomanizationPrimary: true });
    const { container, getByRole, queryByRole } = renderWithProviders(<div className={hostClass}>
      <button>Transport</button><FsLyricsApple currentTrack={track} />
    </div>);
    const surface = container.querySelector('.fsa-lyrics-surface')!;
    const viewport = container.querySelector('.fsa-lyrics-container')!;
    const row = container.querySelector('.fsa-lyric-line')!;
    expect(surface.children).toHaveLength(2);
    act(() => useAuthStore.getState().setLyricsSizeIndicatorEnabled(false));
    expect(queryByRole('button', { name: /Reset size/ })).toBeNull();
    expect(surface.children).toHaveLength(1); // No badge wrapper/row remains.
    expect(surface.firstElementChild).toBe(viewport);
    expect(surface).toHaveClass('fsa-lyrics-surface--no-size-indicator');
    expect(useAuthStore.getState().lyricsScale).toBe(1.5);
    fireEvent.wheel(viewport, { ctrlKey: true, deltaY: -100 });
    expect(useAuthStore.getState().lyricsScale).toBe(1.6);
    getByRole('button', { name: 'Transport' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: '-', metaKey: true });
    expect(useAuthStore.getState().lyricsScale).toBe(1.5);
    fireEvent.keyDown(document.activeElement!, { key: '0', ctrlKey: true });
    expect(useAuthStore.getState().lyricsScale).toBe(1);
    fireEvent.keyDown(document.activeElement!, { key: '+', ctrlKey: true });
    expect(useAuthStore.getState().lyricsScale).toBe(1.1);
    expect(viewport).toHaveStyle({ '--lyrics-scale': '1.1' });
    expect(container.querySelector('.fsa-lyric-line')).toBe(row);
    expect(row).toHaveAttribute('data-time', '0');
    expect(row.firstElementChild).toHaveClass('lyrics-line-content--romanization-primary');
    act(() => useAuthStore.getState().setLyricsSizeIndicatorEnabled(true));
    expect(getByRole('button', { name: /Reset size/ })).toHaveTextContent('110%');
    expect(surface).not.toHaveClass('fsa-lyrics-surface--no-size-indicator');
  });

  it.each([['fs-player', 64], ['fsp', 0], ['fsp2-player', 0]])(
    'keeps badge-off close clearance outside the scrollport only in immersive %s', (hostClass, expectedTop) => {
      const css = readFileSync(resolve(process.cwd(), 'src/styles/components/fullscreen-player-adaptive-portrait.css'), 'utf8');
      const style = document.createElement('style');
      // Test the real CSS/DOM contract, not glyph clipping (jsdom has no layout).
      style.textContent = css.match(/[^{}]*\.(?:fsr-lyrics-surface|fsa-lyrics-surface(?:--no-size-indicator)?|fsa-lyrics-container|fsa-lyrics-top-pad)\s*\{[^}]*\}/g)?.join('\n') ?? '';
      document.head.appendChild(style);
      try {
        useAuthStore.getState().setLyricsSizeIndicatorEnabled(false);
        const { container, getByRole, queryByRole } = renderWithProviders(<div className={hostClass}><FsLyricsApple currentTrack={track} /></div>);
        const surface = container.querySelector('.fsa-lyrics-surface')!;
        const viewport = container.querySelector<HTMLElement>('.fsa-lyrics-container')!;
        const pad = container.querySelector('.fsa-lyrics-top-pad')!;
        // jsdom may leave inset shorthand unexpanded instead of reporting top.
        const surfaceTop = () => {
          const computed = getComputedStyle(surface);
          return parseFloat(computed.top && computed.top !== 'auto' ? computed.top : computed.inset);
        };
        expect(getComputedStyle(surface).position).toBe('absolute');
        expect(viewport.parentElement).toBe(surface);
        expect(getComputedStyle(viewport).overflowY).toBe('auto');
        expect(surfaceTop()).toBe(expectedTop);
        expect(getComputedStyle(pad).height).toBe('16px');
        expect(queryByRole('button', { name: /Reset size/ })).toBeNull();
        for (const scrollTop of [100, 220]) {
          viewport.scrollTop = scrollTop;
          fireEvent.scroll(viewport);
          expect(surfaceTop()).toBe(expectedTop);
          expect(getComputedStyle(pad).height).toBe('16px');
        }
        act(() => useAuthStore.getState().setLyricsSizeIndicatorEnabled(true));
        expect(surfaceTop()).toBe(0);
        expect(getComputedStyle(pad).height).toBe('16px');
        expect(getByRole('button', { name: /Reset size/ })).toBeInTheDocument();
      } finally { style.remove(); }
    },
  );

  it('changes once with panel/fullscreen coexistence, switches renderers and releases keys when lyrics hide', () => {
    useAuthStore.setState({ lyricsSources: [{ id: 'server', enabled: true }] });
    const view = (style: 'apple' | 'rail' | 'hidden') => <><LyricsPane currentTrack={track} /><div className="fs-player" role="dialog" aria-modal="true">
      <button>Transport</button>
      {style === 'apple' ? <FsLyricsApple currentTrack={track} /> : style === 'rail' ? <FsLyricsRail currentTrack={track} /> : null}
    </div></>;
    const { getByRole, getAllByRole, rerender } = renderWithProviders(view('apple'));
    getByRole('button', { name: 'Transport' }).focus();
    const writes = vi.fn();
    const unsubscribe = useAuthStore.subscribe(writes);
    try {
      fireEvent.keyDown(document.activeElement!, { key: '=', ctrlKey: true });
      expect(writes).toHaveBeenCalledTimes(1);
      getAllByRole('button', { name: /Reset size/ }).forEach(badge => expect(badge).toHaveTextContent('110%'));
      rerender(view('rail'));
      fireEvent.keyDown(getByRole('button', { name: 'Transport' }), { key: '-', ctrlKey: true });
      expect(writes).toHaveBeenCalledTimes(2);
      expect(useAuthStore.getState().lyricsScale).toBe(1);
      rerender(view('hidden'));
      const event = new KeyboardEvent('keydown', { key: '+', ctrlKey: true, bubbles: true, cancelable: true });
      act(() => { getByRole('button', { name: 'Transport' }).dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(false);
      expect(writes).toHaveBeenCalledTimes(2);
    } finally { unsubscribe(); }
  });

  it.each(['fsp', 'fsp2-player'])('offers the same compact plain/static badge in the %s host', hostClass => {
    useAuthStore.setState({ lyricsStaticOnly: true });
    result.current!.plainLyrics = 'original\nfallback';
    const { getByRole, container } = renderWithProviders(<div className={hostClass}><FsLyricsApple currentTrack={track} /></div>);
    const badge = getByRole('button', { name: /Reset size/ });
    expect(badge).toHaveClass('lyrics-zoom-badge');
    expect(badge.closest('[aria-hidden="true"], .fsa-lyrics-container')).toBeNull();
    fireEvent.wheel(badge, { deltaY: -100 });
    expect(badge).toHaveTextContent('110%');
    expect(container.querySelectorAll('.fsa-plain-line')).toHaveLength(2);
  });
  it('offers a reachable percentage badge outside scrolling lyrics and handles player-chrome shortcuts', async () => {
    const seek = vi.fn();
    usePlayerStore.setState({ seek });
    const { getByRole, container } = renderWithProviders(<div className="fs-player"><button>Transport</button><FsLyricsApple currentTrack={track} /></div>);
    const badge = getByRole('button', { name: /Reset size/ });
    expect(badge.closest('[aria-hidden="true"], .fsa-lyrics-container')).toBeNull();
    fireEvent.wheel(badge, { deltaY: -100 });
    expect(useAuthStore.getState().lyricsScale).toBe(1.1);
    expect(getByRole('button', { name: /Reset size/ })).toHaveTextContent('110%');
    expect(seek).not.toHaveBeenCalled();
    await userEvent.click(badge);
    expect(useAuthStore.getState().lyricsScale).toBe(1);
    getByRole('button', { name: 'Transport' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: '-', ctrlKey: true });
    expect(useAuthStore.getState().lyricsScale).toBe(0.9);
    expect(container.querySelector('.fsa-lyrics-container')).toHaveStyle({ '--lyrics-scale': '0.9' });
  });
  it('uses persisted scale, per-line primary fallback and translation without losing seek timestamps', () => {
    useAuthStore.setState({ lyricsScale: 2, lyricsRomanizationEnabled: true, lyricsRomanizationPrimary: true, lyricsTranslationEnabled: true });
    const { container } = renderWithProviders(<FsLyricsApple currentTrack={track} />);
    expect(container.querySelector('.fsa-lyrics-container')).toHaveStyle({ '--lyrics-scale': '2' });
    const rows = container.querySelectorAll('.fsa-lyric-line');
    expect(rows[0]).toHaveAttribute('data-time', '0');
    expect(rows[0].firstElementChild).toHaveClass('lyrics-line-content--romanization-primary');
    expect(rows[0].firstElementChild?.firstElementChild).toHaveClass('lyrics-romanization');
    expect(rows[0].querySelector('.lyrics-translation')).toHaveTextContent('translation');
    expect(rows[1]).toHaveAttribute('data-time', '10');
    expect(rows[1].firstElementChild).not.toHaveClass('lyrics-line-content--romanization-primary');
  });

  it('does not treat Ctrl/Meta zoom as manual scrolling, but honours ordinary wheel grace', () => {
    vi.useFakeTimers();
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { container } = renderWithProviders(<FsLyricsApple currentTrack={track} />);
    scroll.mockClear();
    const viewport = container.querySelector('.fsa-lyrics-container')!;
    fireEvent.wheel(viewport, { metaKey: true, deltaY: -100 });
    expect(useAuthStore.getState().lyricsScale).toBe(1.1);
    expect(scroll).toHaveBeenCalled();
    scroll.mockClear();
    fireEvent.wheel(viewport, { deltaY: 100 });
    act(() => useAuthStore.getState().setLyricsScale(1.5));
    expect(scroll).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(4000); });
    act(() => useAuthStore.getState().setLyricsRomanizationPrimary(true));
    expect(scroll).toHaveBeenCalled();
  });

  it('preserves timed word nodes and pronunciation progress across primary/scale changes', () => {
    const subscribe = vi.spyOn(smoothClock, 'subscribeSmoothPlaybackTime');
    useAuthStore.setState({ lyricsRomanizationEnabled: true, lyricsWordHighlightMode: 'smooth' });
    result.current!.wordLines = [{ time: 0, text: 'original', duration: 10, words: [{ time: 0, text: 'original', duration: 10 }] }];
    const { container } = renderWithProviders(<FsLyricsApple currentTrack={track} />);
    act(() => emitPlaybackSeek(5));
    const word = container.querySelector('.fsa-lyric-word')!;
    const pronunciation = container.querySelector<HTMLElement>('.lyrics-romanization')!;
    const subscriptions = subscribe.mock.calls.length;
    expect(word).toHaveClass('active');
    expect(pronunciation.style.getPropertyValue('--lyrics-romanization-progress')).toBe('50%');
    act(() => {
      useAuthStore.getState().setLyricsScale(1.5);
      useAuthStore.getState().setLyricsRomanizationPrimary(true);
    });
    expect(container.querySelector('.fsa-lyric-word')).toBe(word);
    expect(container.querySelector('.lyrics-romanization')).toBe(pronunciation);
    expect(pronunciation.style.getPropertyValue('--lyrics-romanization-progress')).toBe('50%');
    act(() => emitPlaybackSeek(8));
    expect(pronunciation.style.getPropertyValue('--lyrics-romanization-progress')).toBe('80%');
    expect(subscribe).toHaveBeenCalledTimes(subscriptions);
  });

  it('zooms plain/static text and removes listeners across loading and no-track branches', () => {
    useAuthStore.setState({ lyricsStaticOnly: true });
    result.current!.plainLyrics = 'original\nfallback';
    const { container, rerender, unmount } = renderWithProviders(<FsLyricsApple currentTrack={null} />);
    expect(container.querySelector('.fsa-lyrics-container')).toBeNull();
    rerender(<FsLyricsApple currentTrack={track} />);
    const node = container.querySelector('.fsa-lyrics-container')!;
    expect(container.querySelectorAll('.fsa-plain-line')).toHaveLength(2);
    const zoom = () => new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true });
    act(() => { node.dispatchEvent(zoom()); });
    expect(useAuthStore.getState().lyricsScale).toBe(1.1);
    result.current = { ...result.current!, loading: true };
    // Memoized surface receives a new track object to model the parent update.
    rerender(<FsLyricsApple currentTrack={{ ...track }} />);
    expect(container.querySelector('.fsa-lyrics-container')).toBeNull();
    const old = zoom();
    act(() => { node.dispatchEvent(old); });
    expect(old.defaultPrevented).toBe(false);
    unmount();
  });
});
