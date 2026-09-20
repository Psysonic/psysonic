import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import BottomNav from '@/features/sidebar/components/BottomNav';
import { useLiveSearchScopeStore } from '@/store/liveSearchScopeStore';
import { OPEN_SEARCH_EVENT } from '@/lib/dom/openSearch';

vi.mock('@/features/search/hooks/useShareSearch', () => ({
  useShareSearch: () => ({ shareMatch: null }),
}));
vi.mock('@/features/search/hooks/useLiveSearchQuery', () => ({
  useLiveSearchQuery: () => ({ indexIncomplete: false }),
}));
vi.mock('@/cover/AlbumCoverArtImage', () => ({ AlbumCoverArtImage: () => null }));
vi.mock('@/cover/ArtistCoverArtImage', () => ({ ArtistCoverArtImage: () => null }));
vi.mock('@/cover/CoverArtImage', () => ({ CoverArtImage: () => null }));

describe('BottomNav search shortcut request', () => {
  beforeEach(() => {
    useLiveSearchScopeStore.setState({ query: '', scope: null, undoStack: [] });
  });

  it('opens the mobile search overlay and focuses its input', () => {
    renderWithProviders(<BottomNav />);

    const event = new Event(OPEN_SEARCH_EVENT, { cancelable: true });
    act(() => window.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  it('closes the mobile search overlay and releases focus on Escape', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BottomNav />);

    act(() => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT, { cancelable: true })));
    expect(screen.getByRole('searchbox')).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(document.body).toHaveFocus();
  });
});
