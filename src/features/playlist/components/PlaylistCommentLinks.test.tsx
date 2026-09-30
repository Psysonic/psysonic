import { open } from '@tauri-apps/plugin-shell';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PlaylistCommentLinks from './PlaylistCommentLinks';
import { showToast } from '@/lib/dom/toast';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';

vi.mock('@/lib/dom/toast', () => ({ showToast: vi.fn() }));

describe('PlaylistCommentLinks', () => {
  it('links web URLs and Markdown labels without losing surrounding text or punctuation', () => {
    const view = renderWithProviders(
      <PlaylistCommentLinks comment={'Listen: https://example.org/mix?q=1, or [website](http://radio.example/sets).\nNext song'} />,
    );

    expect(view.getByRole('link', { name: 'https://example.org/mix?q=1' })).toHaveAttribute('href', 'https://example.org/mix?q=1');
    expect(view.getByRole('link', { name: 'website' })).toHaveAttribute('href', 'http://radio.example/sets');
    expect(view.container.querySelector('.playlist-comment')).toHaveTextContent('Listen: https://example.org/mix?q=1, or website. Next song');
  });

  it('does not turn scripts, credentials, or HTML into active content', () => {
    const view = renderWithProviders(
      <PlaylistCommentLinks comment={'<img src=x onerror=alert(1)> [bad](javascript:alert(1)) https://user:pass@example.org/'} />,
    );

    expect(view.queryByRole('link')).not.toBeInTheDocument();
    expect(view.container.querySelector('img')).not.toBeInTheDocument();
    expect(view.getByText(/javascript:alert/)).toBeInTheDocument();
  });

  it('preserves balanced parentheses inside a bare URL', () => {
    const view = renderWithProviders(<PlaylistCommentLinks comment="See https://example.org/wiki/Foo_(bar)." />);
    expect(view.getByRole('link')).toHaveAttribute('href', 'https://example.org/wiki/Foo_(bar)');
    expect(view.container.querySelector('.playlist-comment')).toHaveTextContent('See https://example.org/wiki/Foo_(bar).');
  });

  it('opens the destination directly in the system browser', async () => {
    const user = userEvent.setup();
    const view = renderWithProviders(<PlaylistCommentLinks comment="[Listen here](https://example.org/music)" />);
    const link = view.getByRole('link', { name: 'Listen here' });

    await user.click(link);
    expect(open).toHaveBeenCalledWith('https://example.org/music');
    expect(view.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows an error toast if the browser cannot open the link', async () => {
    vi.mocked(open).mockRejectedValueOnce(new Error('blocked'));
    const user = userEvent.setup();
    const view = renderWithProviders(<PlaylistCommentLinks comment="https://example.org" />);

    await user.click(view.getByRole('link'));
    expect(showToast).toHaveBeenCalledWith('Could not open this link in your browser.', 4000, 'error');
    expect(view.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
