import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseLyricsResult } from '@/features/lyrics/hooks/useLyrics';
import type { Track } from '@/lib/media/trackTypes';
import { useAuthStore } from '@/store/authStore';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { EaseScroller } from '@/lib/dom/easeScroll';
import { parseLrc } from '@/features/lyrics/utils/lrc';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lyricsResult = vi.hoisted(() => ({ current: null as UseLyricsResult | null }));

vi.mock('@/features/lyrics/hooks/useLyrics', () => ({
  useLyrics: () => lyricsResult.current,
}));

import LyricsPane from './LyricsPane';

const track: Track = {
  id: 'song-1',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  albumId: 'album-1',
  duration: 180,
};

function lyrics(overrides: Partial<UseLyricsResult> = {}): UseLyricsResult {
  return {
    syncedLines: null,
    wordLines: null,
    plainLyrics: 'first line\nsecond line',
    pronunciationLines: null,
    pronunciationPlainLyrics: null,
    translations: [],
    source: 'server',
    loading: false,
    notFound: false,
    refresh: () => {},
    ...overrides,
  };
}

beforeEach(() => {
  resetAuthStore();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 423, 322));
  useAuthStore.setState({
    lyricsSources: [{ id: 'server', enabled: true }],
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('LyricsPane shared appearance', () => {
  it.each(['classic', 'apple'] as const)('removes the badge row but keeps %s panel keys/wheel and content layers working', style => {
    useAuthStore.setState({ sidebarLyricsStyle: style, lyricsScale: 1.5, lyricsRomanizationEnabled: true, lyricsRomanizationPrimary: true });
    lyricsResult.current = lyrics({ pronunciationPlainLyrics: 'pronunciation\n' });
    const { container } = renderWithProviders(<LyricsPane currentTrack={track} />);
    const surface = container.querySelector('.lyrics-pane-wrap')!;
    const viewport = container.querySelector('.lyrics-pane__viewport')!;
    const content = container.querySelector('.lyrics-line-content')!;
    const first = surface.firstElementChild;
    const scrollContainer = first!.nextElementSibling;
    expect(first).toHaveClass('lyrics-zoom-badge');
    act(() => useAuthStore.getState().setLyricsSizeIndicatorEnabled(false));
    expect(screen.queryByRole('button', { name: /Reset size/ })).not.toBeInTheDocument();
    expect(surface.firstElementChild).toBe(scrollContainer);
    expect(scrollContainer).toContainElement(viewport as HTMLElement);
    expect(container.querySelector('.lyrics-pane__viewport')).toBe(viewport);
    expect(useAuthStore.getState().lyricsScale).toBe(1.5);
    fireEvent.wheel(viewport, { ctrlKey: true, deltaY: -100 });
    expect(useAuthStore.getState().lyricsScale).toBe(1.6);
    screen.getByRole('button', { name: 'Refresh lyrics' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: '-', metaKey: true });
    expect(useAuthStore.getState().lyricsScale).toBe(1.5);
    fireEvent.keyDown(document.activeElement!, { key: '0', ctrlKey: true });
    expect(useAuthStore.getState().lyricsScale).toBe(1);
    fireEvent.keyDown(document.activeElement!, { key: '+', ctrlKey: true });
    expect(useAuthStore.getState().lyricsScale).toBe(1.1);
    expect(surface).toHaveStyle({ '--lyrics-scale': '1.1' });
    expect(container.querySelector('.lyrics-line-content')).toBe(content);
    expect(content).toHaveClass('lyrics-line-content--romanization-primary');
    act(() => useAuthStore.getState().setLyricsSizeIndicatorEnabled(true));
    expect(screen.getByRole('button', { name: /Reset size/ })).toHaveTextContent('110%');
  });

  it('keeps a single small inset below the badge without changing row or end spacing', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/components/help-page.css'), 'utf8');
    const style = document.createElement('style');
    // jsdom does not lay out text. Apply the real spacing rules to check the
    // cumulative inset; the coordinator's browser fixture measures glyphs.
    style.textContent = ['lyrics-pane__viewport', 'lyrics-synced', 'lyrics-line']
      .map(name => css.match(new RegExp(`\\.${name}\\s*\\{[^}]*\\}`))?.[0] ?? '')
      .join('\n');
    document.head.appendChild(style);
    try {
      lyricsResult.current = lyrics({ syncedLines: [{ time: 0, text: 'first line' }], plainLyrics: null });
      const { container } = renderWithProviders(<LyricsPane currentTrack={track} />);
      const viewport = getComputedStyle(container.querySelector('.lyrics-pane__viewport')!);
      const list = getComputedStyle(container.querySelector('.lyrics-synced')!);
      const row = getComputedStyle(container.querySelector('.lyrics-line')!);
      expect(parseFloat(viewport.paddingTop) + parseFloat(list.paddingTop)).toBe(8);
      expect(viewport.paddingRight).toBe('16px');
      expect(viewport.paddingBottom).toBe('8px');
      expect(list.paddingBottom).toBe('40px');
      expect(row.paddingTop).toBe('5px');
      expect(row.paddingBottom).toBe('5px');
    } finally { style.remove(); }
  });

  // Leading blank timestamp rows retain their visual height and timing indices;
  // only redundant container/list padding was approved for removal.
  it.each([1, 2])('retains a full leading blank timestamp row before the first visible lyric (scale %s)', scale => {
    useAuthStore.setState({ lyricsScale: scale });
    const syncedLines = parseLrc('[00:00.00]\n[00:10.00]One Two Three O’clock Four O’clock rock\n[00:15.00]Five Six Seven O’clock Eight O’clock rock');
    expect(syncedLines[0]).toEqual({ time: 0, text: '' });
    lyricsResult.current = lyrics({ syncedLines, plainLyrics: null });
    const { container } = renderWithProviders(<LyricsPane currentTrack={track} />);
    const rows = container.querySelectorAll('.lyrics-line');
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector('.lyrics-line-primary')!.textContent).toBe('\u00a0');
    expect(rows[0]).not.toHaveAttribute('hidden');
    expect(rows[0]).not.toHaveStyle({ display: 'none' });
    expect(rows[1]).toHaveTextContent('One Two Three');
    expect(container.querySelector('.lyrics-pane-wrap')).toHaveStyle({ '--lyrics-scale': String(scale) });
  });
  it.each([false, true])('scales plain/static text, preserves controls and prefers available pronunciation (static: %s)', staticOnly => {
    useAuthStore.setState({ lyricsScale: 1.8, lyricsRomanizationPrimary: true, lyricsRomanizationEnabled: true, lyricsStaticOnly: staticOnly });
    lyricsResult.current = lyrics({
      syncedLines: staticOnly ? [{ time: 0, text: 'first line' }, { time: 10, text: 'second line' }] : null,
      pronunciationPlainLyrics: 'pronunciation\n',
    });
    const { container } = renderWithProviders(<LyricsPane currentTrack={track} />);
    expect(container.querySelector('.lyrics-pane-wrap')).toHaveStyle({ '--lyrics-scale': '1.8' });
    const rows = container.querySelectorAll('.lyrics-plain-line');
    expect(rows).toHaveLength(2);
    expect(rows[0].firstElementChild).toHaveClass('lyrics-line-content--romanization-primary');
    expect(rows[1].firstElementChild).not.toHaveClass('lyrics-line-content--romanization-primary');
    expect(screen.getByRole('button', { name: 'Refresh lyrics' }).style.fontSize).toBe('');
    const badge = screen.getByRole('button', { name: /Reset size/ });
    expect(badge.closest('.lyrics-pane__viewport')).toBeNull();
    fireEvent.wheel(badge, { deltaY: -100 });
    expect(useAuthStore.getState().lyricsScale).toBe(1.9);
    expect(screen.getByRole('button', { name: /Reset size/ })).toHaveTextContent('190%');
  });

  it('zooms with focused or hovered panel keys, not unrelated app chrome', async () => {
    lyricsResult.current = lyrics();
    const { container } = renderWithProviders(<><button>Outside</button><LyricsPane currentTrack={track} /></>);
    screen.getByRole('button', { name: 'Outside' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: '+', ctrlKey: true });
    expect(useAuthStore.getState().lyricsScale).toBe(1);
    fireEvent.pointerEnter(container.querySelector('.lyrics-pane-wrap')!);
    fireEvent.keyDown(document.activeElement!, { key: '=', ctrlKey: true });
    expect(useAuthStore.getState().lyricsScale).toBe(1.1);
    fireEvent.pointerLeave(container.querySelector('.lyrics-pane-wrap')!);
    await userEvent.click(screen.getByRole('button', { name: /Reset size/ }));
    fireEvent.keyDown(document.activeElement!, { key: '-', metaKey: true });
    expect(useAuthStore.getState().lyricsScale).toBe(0.9);
  });

  it('reanchors after zoom/priority changes but respects a real manual-scroll grace period', () => {
    vi.useFakeTimers();
    const jump = vi.spyOn(EaseScroller.prototype, 'jump');
    lyricsResult.current = lyrics({ syncedLines: [{ time: 0, text: 'first line' }] });
    const { container } = renderWithProviders(<LyricsPane currentTrack={track} />);
    act(() => { vi.advanceTimersByTime(20); });
    jump.mockClear();
    const viewport = container.querySelector('.lyrics-pane__viewport')!;
    const zoom = new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true });
    act(() => { viewport.dispatchEvent(zoom); vi.advanceTimersByTime(20); });
    // Effects created by the zoom commit schedule the next animation frame.
    act(() => { vi.advanceTimersByTime(20); });
    expect(zoom.defaultPrevented).toBe(true);
    expect(jump).toHaveBeenCalled();
    jump.mockClear();
    fireEvent.wheel(viewport, { deltaY: 100 });
    act(() => { useAuthStore.getState().setLyricsScale(1.5); });
    act(() => { vi.advanceTimersByTime(20); });
    expect(jump).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(4000); });
    act(() => { useAuthStore.getState().setLyricsRomanizationPrimary(true); });
    act(() => { vi.advanceTimersByTime(20); });
    expect(jump).toHaveBeenCalled();
  });

  it('detaches zoom on no-track/disabled branches and reattaches after lyrics mount', () => {
    lyricsResult.current = lyrics();
    const { container, rerender } = renderWithProviders(<LyricsPane currentTrack={null} />);
    expect(container.querySelector('.lyrics-pane__viewport')).toBeNull();
    rerender(<LyricsPane currentTrack={track} />);
    const viewport = container.querySelector('.lyrics-pane__viewport')!;
    const event = () => new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true });
    act(() => { viewport.dispatchEvent(event()); });
    expect(useAuthStore.getState().lyricsScale).toBe(1.1);
    act(() => useAuthStore.setState({ lyricsSources: [] }));
    const detached = event();
    act(() => { viewport.dispatchEvent(detached); });
    expect(detached.defaultPrevented).toBe(false);
    expect(useAuthStore.getState().lyricsScale).toBe(1.1);
  });
});

describe('LyricsPane translation toggle', () => {
  it('turns the translation line on from the footer', async () => {
    const user = userEvent.setup();
    lyricsResult.current = lyrics({
      translations: [{ lang: 'de', lines: null, plainLyrics: 'erste Zeile\nzweite Zeile' }],
    });
    renderWithProviders(<LyricsPane currentTrack={track} />);

    const toggle = screen.getByRole('button', { name: 'Translation' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('erste Zeile')).not.toBeInTheDocument();

    await user.click(toggle);

    expect(useAuthStore.getState().lyricsTranslationEnabled).toBe(true);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('erste Zeile')).toBeInTheDocument();
    expect(screen.getByText('zweite Zeile')).toBeInTheDocument();
  });

  it('shows the translation in the app language when there are several', () => {
    useAuthStore.setState({ lyricsTranslationEnabled: true });
    lyricsResult.current = lyrics({
      translations: [
        { lang: 'en', lines: null, plainLyrics: 'english one\nenglish two' },
        { lang: 'de', lines: null, plainLyrics: 'erste Zeile\nzweite Zeile' },
      ],
    });
    renderWithProviders(<LyricsPane currentTrack={track} />, { language: 'de' });

    expect(screen.getByText('erste Zeile')).toBeInTheDocument();
    expect(screen.queryByText('english one')).not.toBeInTheDocument();
  });

  it('offers no toggle for lyrics without a translation', () => {
    lyricsResult.current = lyrics();
    renderWithProviders(<LyricsPane currentTrack={track} />);

    expect(screen.queryByRole('button', { name: 'Translation' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh lyrics' })).toBeInTheDocument();
  });
});
