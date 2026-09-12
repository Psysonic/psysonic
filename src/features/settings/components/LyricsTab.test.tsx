import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
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
});
