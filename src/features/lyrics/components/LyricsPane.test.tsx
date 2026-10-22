import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseLyricsResult } from '@/features/lyrics/hooks/useLyrics';
import type { Track } from '@/lib/media/trackTypes';
import { useAuthStore } from '@/store/authStore';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAuthStore } from '@/test/helpers/storeReset';

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
  useAuthStore.setState({
    lyricsSources: [{ id: 'server', enabled: true }],
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
