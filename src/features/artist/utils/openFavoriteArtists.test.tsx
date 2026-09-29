/**
 * The Favorites artists heading has to arrive on Artists with the favourites
 * filter on — the twin of `openFavoriteAlbums`.
 *
 * As there, the test navigates the way a click does — a PUSH from another route.
 * On a fresh router the navigation counts as POP and the page restores its
 * session anyway, which would hide a filter that does not survive in the app.
 */
import React from 'react';
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { openFavoriteArtists } from '@/features/artist/utils/openFavoriteArtists';
import { useArtistsBrowseFilters } from '@/features/artist/hooks/useArtistsBrowseFilters';
import { useArtistViewModeStore } from '@/features/artist/store/artistViewModeStore';
import { ALL_SENTINEL } from '@/features/artist/utils/artistsHelpers';
import { getLibraryBrowseScope } from '@/lib/library/libraryBrowseScope';
import { resetAllStores } from '@/test/helpers/storeReset';
import { useAuthStore } from '@/store/authStore';

function FavoritesStub() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => openFavoriteArtists(navigate)}>
      open favourites
    </button>
  );
}

/** Reads the filters from the server the Artists page browses from. */
function ArtistsProbe() {
  const activeServerId = useAuthStore(s => s.activeServerId ?? '');
  const serverId = getLibraryBrowseScope().anchorServerId ?? activeServerId;
  const { starredOnly, letterFilter, creditMode, viewMode } = useArtistsBrowseFilters(serverId);
  const showArtistImages = useAuthStore(s => s.showArtistImages);
  return (
    <div>
      <span data-testid="starred">{String(starredOnly)}</span>
      <span data-testid="letter">{letterFilter}</span>
      <span data-testid="credit">{creditMode}</span>
      <span data-testid="view">{viewMode}</span>
      <span data-testid="images">{String(showArtistImages)}</span>
    </div>
  );
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/favorites']}>
      <Routes>
        <Route path="/favorites" element={<FavoritesStub />} />
        <Route path="/artists" element={<ArtistsProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function addServer(name: string, url: string): string {
  return useAuthStore.getState().addServer({ name, url, username: 'u', password: 'p' });
}

async function openAndWaitForFilter() {
  renderApp();
  fireEvent.click(screen.getByText('open favourites'));
  await waitFor(() => {
    expect(screen.getByTestId('starred').textContent).toBe('true');
  });
}

beforeEach(() => {
  resetAllStores();
});

describe('openFavoriteArtists', () => {
  it('lands on Artists with the favourites filter on and no letter filter', async () => {
    const serverId = addServer('T', 'https://fav.test');
    useAuthStore.getState().setActiveServer(serverId);

    await openAndWaitForFilter();
    expect(screen.getByTestId('letter').textContent).toBe(ALL_SENTINEL);
  });

  it('keeps the viewer’s credit mode, view mode and artist images', async () => {
    const serverId = addServer('T', 'https://fav.test');
    useAuthStore.getState().setActiveServer(serverId);
    useAuthStore.getState().setArtistBrowseCreditMode('track');
    useAuthStore.getState().setShowArtistImages(false);
    useArtistViewModeStore.getState().setViewMode('list');

    await openAndWaitForFilter();
    expect(screen.getByTestId('credit').textContent).toBe('track');
    expect(screen.getByTestId('view').textContent).toBe('list');
    expect(screen.getByTestId('images').textContent).toBe('false');
  });

  it('hands the filter to the anchor server when several servers are browsed', async () => {
    const first = addServer('First', 'https://first.test');
    const second = addServer('Second', 'https://second.test');
    useAuthStore.setState({ activeServerId: second, libraryBrowseServerIds: [first, second] });
    expect(getLibraryBrowseScope().anchorServerId).toBe(first);

    await openAndWaitForFilter();
  });
});
