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
import { latestResizeObserver } from '@/test/mocks/browser';

const result = vi.hoisted(() => ({ current: null as UseLyricsResult | null }));
vi.mock('@/features/lyrics/hooks/useLyrics', () => ({ useLyrics: () => result.current }));
import { FsLyricsRail } from './FsLyricsRail';

const track = makeTrack();
beforeEach(() => {
  resetAuthStore();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 423, 322));
  resetPlayerStore();
  usePlayerStore.setState({ currentTrack: track });
  result.current = {
    syncedLines: [{ time: 0, text: 'original' }, { time: 10, text: 'fallback' }],
    wordLines: null, plainLyrics: null,
    pronunciationLines: [{ time: 0, text: 'pronunciation' }], pronunciationPlainLyrics: null,
    translations: [{ lang: 'en', lines: [{ time: 0, text: 'translation' }], plainLyrics: null }],
    source: 'server', loading: false, notFound: false, refresh: () => {},
  };
});
afterEach(() => { vi.restoreAllMocks(); });

describe('fullscreen rail lyrics appearance', () => {
  it('removes the badge without leaving a row or disabling rail wheel/player-chrome keys', () => {
    useAuthStore.setState({ lyricsScale: 1.5, lyricsRomanizationEnabled: true, lyricsRomanizationPrimary: true });
    const { container, getByRole, queryByRole } = renderWithProviders(<div className="fs-player">
      <button>Transport</button><FsLyricsRail currentTrack={track} />
    </div>);
    const surface = container.querySelector('.fsr-lyrics-surface')!;
    const viewport = container.querySelector('.fsr-lyrics-overlay')!;
    const row = container.querySelector('.fsr-lyric-line')!;
    act(() => useAuthStore.getState().setLyricsSizeIndicatorEnabled(false));
    expect(queryByRole('button', { name: /Reset size/ })).toBeNull();
    expect(surface.children).toHaveLength(1);
    expect(surface.firstElementChild).toBe(viewport);
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
    expect(container.querySelector('.fsr-lyric-line')).toBe(row);
    expect(row).toHaveAttribute('data-time', '0');
    expect(row.firstElementChild).toHaveClass('lyrics-line-content--romanization-primary');
    act(() => useAuthStore.getState().setLyricsSizeIndicatorEnabled(true));
    expect(getByRole('button', { name: /Reset size/ })).toHaveTextContent('110%');
  });

  it('keeps the percentage badge outside the hidden/faded rail and out of line-seek hit areas', async () => {
    const seek = vi.fn();
    usePlayerStore.setState({ seek });
    const { getByRole } = renderWithProviders(<div className="fs-player"><FsLyricsRail currentTrack={track} /><button>Transport</button></div>);
    const badge = getByRole('button', { name: /Reset size/ });
    expect(badge.closest('[aria-hidden="true"], .fsr-lyrics-overlay')).toBeNull();
    fireEvent.wheel(badge, { deltaY: -100 });
    expect(useAuthStore.getState().lyricsScale).toBe(1.1);
    expect(seek).not.toHaveBeenCalled();
    await userEvent.click(badge);
    expect(useAuthStore.getState().lyricsScale).toBe(1);
    getByRole('button', { name: 'Transport' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: '0', ctrlKey: true });
    expect(useAuthStore.getState().lyricsScale).toBe(1);
  });
  it('shares size/primary preference, preserves line timestamps and cancels Ctrl wheel', () => {
    useAuthStore.setState({ lyricsScale: 1.6, lyricsRomanizationEnabled: true, lyricsRomanizationPrimary: true, lyricsTranslationEnabled: true });
    const { container } = renderWithProviders(<FsLyricsRail currentTrack={track} />);
    const node = container.querySelector('.fsr-lyrics-overlay')!;
    expect(node).toHaveStyle({ '--lyrics-scale': '1.6' });
    const rows = container.querySelectorAll('.fsr-lyric-line');
    expect(rows[0]).toHaveAttribute('data-time', '0');
    expect(rows[0].firstElementChild).toHaveClass('lyrics-line-content--romanization-primary');
    expect(rows[0].querySelector('.lyrics-translation')).toHaveTextContent('translation');
    expect(rows[1]).toHaveAttribute('data-time', '10');
    expect(rows[1].firstElementChild).not.toHaveClass('lyrics-line-content--romanization-primary');
    const zoom = new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true });
    act(() => { node.dispatchEvent(zoom); });
    expect(zoom.defaultPrevented).toBe(true);
    expect(useAuthStore.getState().lyricsScale).toBe(1.7);
    fireEvent.wheel(node, { deltaY: 100 });
    expect(useAuthStore.getState().lyricsScale).toBe(1.7);
  });

  it('preserves word refs and pronunciation progress while changing appearance', () => {
    const subscribe = vi.spyOn(smoothClock, 'subscribeSmoothPlaybackTime');
    useAuthStore.setState({ lyricsRomanizationEnabled: true, lyricsWordHighlightMode: 'smooth' });
    result.current!.wordLines = [{ time: 0, duration: 10, text: 'original', words: [{ time: 0, duration: 10, text: 'original' }] }];
    const { container } = renderWithProviders(<FsLyricsRail currentTrack={track} />);
    act(() => emitPlaybackSeek(5));
    const word = container.querySelector('.fsr-lyric-word')!;
    const pronunciation = container.querySelector<HTMLElement>('.lyrics-romanization')!;
    const subscriptions = subscribe.mock.calls.length;
    expect(word).toHaveClass('active');
    expect(pronunciation.style.getPropertyValue('--lyrics-romanization-progress')).toBe('50%');
    act(() => {
      useAuthStore.getState().setLyricsRomanizationPrimary(true);
      useAuthStore.getState().setLyricsScale(2);
    });
    expect(container.querySelector('.fsr-lyric-word')).toBe(word);
    expect(pronunciation.style.getPropertyValue('--lyrics-romanization-progress')).toBe('50%');
    act(() => emitPlaybackSeek(8));
    expect(pronunciation.style.getPropertyValue('--lyrics-romanization-progress')).toBe('80%');
    expect(subscribe).toHaveBeenCalledTimes(subscriptions);
  });

  it('mounts after loading and removes wheel/resize observers when hidden', () => {
    result.current!.loading = true;
    const { container, rerender, unmount } = renderWithProviders(<FsLyricsRail currentTrack={track} />);
    expect(container.querySelector('.fsr-lyrics-overlay')).toBeNull();
    result.current = { ...result.current!, loading: false };
    rerender(<FsLyricsRail currentTrack={{ ...track }} />);
    const old = container.querySelector('.fsr-lyrics-overlay')!;
    const observer = latestResizeObserver()!;
    rerender(<FsLyricsRail currentTrack={null} />);
    expect(observer.disconnect).toHaveBeenCalled();
    const event = new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true });
    act(() => { old.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
    expect(useAuthStore.getState().lyricsScale).toBe(1);
    unmount();
  });
});
