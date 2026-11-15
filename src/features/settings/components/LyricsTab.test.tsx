import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { useAuthStore } from '@/store/authStore';
import { LyricsTab } from './LyricsTab';

beforeEach(resetAuthStore);

describe('LyricsTab', () => {
  it('offers a labelled native size range, percentage and keyboard-reachable reset', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LyricsTab />);
    await user.click(screen.getByText('Lyrics size', { selector: 'summary span' }));
    const range = screen.getByRole('slider', { name: 'Lyrics size' });
    expect(range).toHaveValue('100');
    expect(range).toHaveAttribute('min', '50');
    expect(range).toHaveAttribute('max', '200');
    expect(range).toHaveAttribute('step', '10');
    expect(range).toHaveAccessibleDescription(/Ctrl or ⌘/);
    // jsdom has no native range drag/arrow default action: deliver its change.
    fireEvent.change(range, { target: { value: '170' } });
    expect(useAuthStore.getState().lyricsScale).toBe(1.7);
    expect(range).toHaveAttribute('aria-valuetext', '170%');
    const reset = screen.getByRole('button', { name: 'Reset size' });
    range.focus();
    await user.tab();
    expect(reset).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(useAuthStore.getState().lyricsScale).toBe(1);
    expect(range).toHaveValue('100');
  });

  it('offers the size-indicator toggle under Lyrics size, keeping size/reset usable while off', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LyricsTab />);
    await user.click(screen.getByText('Lyrics size', { selector: 'summary span' }));
    const section = screen.getByText('Lyrics size', { selector: 'summary span' }).closest('details')!;
    const toggle = within(section).getByRole('checkbox', { name: 'Show size in lyrics' });
    expect(toggle).toBeChecked();
    toggle.focus();
    await user.keyboard(' ');
    expect(toggle).not.toBeChecked();
    expect(useAuthStore.getState().lyricsSizeIndicatorEnabled).toBe(false);
    const range = within(section).getByRole('slider', { name: 'Lyrics size' });
    expect(range).toBeEnabled();
    fireEvent.change(range, { target: { value: '160' } });
    expect(range).toHaveAttribute('aria-valuetext', '160%');
    expect(within(section).getByText('160%')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Reset size' }));
    expect(range).toHaveValue('100');
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(useAuthStore.getState().lyricsSizeIndicatorEnabled).toBe(true);
  });

  it('saves primary pronunciation independently of enabling pronunciation', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LyricsTab />);
    await user.click(screen.getByText('Pronunciation'));
    const primary = screen.getByRole('checkbox', { name: 'Pronunciation as the primary line' });
    expect(primary).not.toBeChecked();
    await user.click(primary);
    expect(useAuthStore.getState().lyricsRomanizationPrimary).toBe(true);
    expect(useAuthStore.getState().lyricsRomanizationEnabled).toBe(false);
    const enabled = screen.getByRole('checkbox', { name: 'Pronunciation and Japanese romaji' });
    await user.click(enabled);
    await user.click(enabled);
    expect(primary).toBeChecked();
  });

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

  it('offers the translation line as its own setting, off by default', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LyricsTab />);

    const section = screen.getByText('Translation').closest('details');
    expect(section).not.toBeNull();
    await user.click(screen.getByText('Translation'));
    const toggle = within(section!).getByRole('checkbox', { name: 'Show translation' });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);
    expect(useAuthStore.getState().lyricsTranslationEnabled).toBe(true);
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
