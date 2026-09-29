import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import LiveSearch from '@/features/search/components/LiveSearch';
import { useLiveSearchScopeStore } from '@/store/liveSearchScopeStore';
import { OPEN_SEARCH_EVENT } from '@/lib/dom/openSearch';

vi.mock('@/features/album', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/album')>(),
  useNavigateToAlbum: () => vi.fn(),
}));
vi.mock('@/features/search/hooks/useLiveSearchHeaderCollapse', () => ({
  useLiveSearchHeaderCollapse: () => true,
}));
vi.mock('@/features/search/hooks/useLiveSearchQuery', () => ({
  useLiveSearchQuery: () => ({ indexIncomplete: false }),
}));
vi.mock('@/features/search/hooks/useShareSearch', () => ({
  useShareSearch: () => ({ shareMatch: null }),
}));

describe('LiveSearch search shortcut request', () => {
  beforeEach(() => {
    useLiveSearchScopeStore.setState({ query: '', scope: null, undoStack: [] });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0);
      return 1;
    });
  });

  it('expands a collapsed desktop search and focuses its input', () => {
    renderWithProviders(
      <div className="app-shell">
        <header className="content-header">
          <LiveSearch />
        </header>
      </div>,
    );

    const event = new Event(OPEN_SEARCH_EVENT, { cancelable: true });
    act(() => window.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole('search')).toHaveAttribute('data-active');
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  it('leaves mobile requests for the mobile search surface', () => {
    renderWithProviders(
      <div className="app-shell" data-mobile>
        <header className="content-header">
          <LiveSearch />
        </header>
      </div>,
    );

    const event = new Event(OPEN_SEARCH_EVENT, { cancelable: true });
    act(() => window.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(false);
    expect(screen.getByRole('searchbox')).not.toHaveFocus();
  });

  it('releases focus when Escape is pressed', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <div className="app-shell">
        <header className="content-header">
          <LiveSearch />
        </header>
      </div>,
    );

    const event = new Event(OPEN_SEARCH_EVENT, { cancelable: true });
    act(() => window.dispatchEvent(event));
    const input = screen.getByRole('searchbox');
    expect(input).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(input).not.toHaveFocus();
    expect(screen.getByRole('search')).not.toHaveAttribute('data-active');
  });

  it('keeps an idle scoped filter collapsed until the shortcut focuses it', async () => {
    const user = userEvent.setup();
    useLiveSearchScopeStore.setState({ query: '', scope: 'tracks', undoStack: [] });
    renderWithProviders(
      <div className="app-shell">
        <header className="content-header">
          <LiveSearch />
        </header>
      </div>,
    );

    const search = screen.getByRole('search');
    expect(search).not.toHaveAttribute('data-active');

    act(() => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT, { cancelable: true })));
    expect(search).toHaveAttribute('data-active');
    expect(screen.getByRole('searchbox')).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(search).not.toHaveAttribute('data-active');
    expect(useLiveSearchScopeStore.getState().scope).toBe('tracks');
  });
});
