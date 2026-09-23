import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { useAuthStore } from '@/store/authStore';
import { LyricsTab } from './LyricsTab';

beforeEach(resetAuthStore);

describe('LyricsTab', () => {
  it('keeps pronunciation separate from the scroll-style section', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LyricsTab />);

    const pronunciationSection = screen.getByText('Pronunciation').closest('details');
    const scrollSection = screen.getByText('Lyrics scroll style').closest('details');
    expect(pronunciationSection).not.toBeNull();
    expect(scrollSection).not.toBeNull();
    expect(within(scrollSection!).queryByText('Pronunciation and Japanese romaji')).not.toBeInTheDocument();

    await user.click(screen.getByText('Pronunciation'));
    expect(within(pronunciationSection!).getByRole('checkbox', {
      name: 'Pronunciation and Japanese romaji',
    })).not.toBeChecked();
  });

  it('stores smooth word highlighting as a separate lyrics mode', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LyricsTab />);

    const section = screen.getByText('Word highlighting').closest('details');
    expect(section).not.toBeNull();
    await user.click(screen.getByText('Word highlighting'));
    await user.click(within(section!).getByRole('radio', { name: 'Smooth' }));

    expect(useAuthStore.getState().lyricsWordHighlightMode).toBe('smooth');
    expect(within(section!).getByText(
      'Gradually fills the current word over its timed duration.',
    )).toBeInTheDocument();

    await user.click(within(section!).getByRole('radio', { name: 'Flow only' }));
    expect(useAuthStore.getState().lyricsWordHighlightMode).toBe('flowing');
    expect(within(section!).getByText(
      'Fills the current word gradually without lighting the whole word first.',
    )).toBeInTheDocument();
  });
});
