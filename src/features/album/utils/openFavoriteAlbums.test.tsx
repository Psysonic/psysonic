/**
 * The Favorites albums heading has to arrive on All Albums with the favourites
 * filter on (#1556).
 *
 * The test navigates the way a click does — a PUSH from another route — rather
 * than mounting the page on a fresh router. That distinction is the whole
 * point: on a fresh router the navigation counts as POP, the page restores its
 * session instead of clearing it, and a filter handed over any other way would
 * appear to survive while it does not in the app.
 */
import React from 'react';
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { openFavoriteAlbums } from '@/features/album/utils/openFavoriteAlbums';
import { useAlbumBrowseFilters } from '@/features/album/hooks/useAlbumBrowseFilters';
import { resetAllStores } from '@/test/helpers/storeReset';
import { useAuthStore } from '@/store/authStore';

let serverId = '';

function FavoritesStub() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => openFavoriteAlbums(navigate)}>
      open favourites
    </button>
  );
}

function AlbumsProbe() {
  const { starredOnly, losslessOnly, selectedGenres } = useAlbumBrowseFilters(serverId);
  return (
    <div>
      <span data-testid="starred">{String(starredOnly)}</span>
      <span data-testid="lossless">{String(losslessOnly)}</span>
      <span data-testid="genres">{selectedGenres.length}</span>
    </div>
  );
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/favorites']}>
      <Routes>
        <Route path="/favorites" element={<FavoritesStub />} />
        <Route path="/albums" element={<AlbumsProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetAllStores();
  serverId = useAuthStore.getState().addServer({
    name: 'T', url: 'https://fav.test', username: 'u', password: 'p',
  });
  useAuthStore.getState().setActiveServer(serverId);
});

describe('openFavoriteAlbums', () => {
  it('lands on All Albums with the favourites filter on', async () => {
    renderApp();
    fireEvent.click(screen.getByText('open favourites'));

    await waitFor(() => {
      expect(screen.getByTestId('starred').textContent).toBe('true');
    });
  });

  it('does not drag any other filter along', async () => {
    renderApp();
    fireEvent.click(screen.getByText('open favourites'));

    await waitFor(() => {
      expect(screen.getByTestId('starred').textContent).toBe('true');
    });
    expect(screen.getByTestId('lossless').textContent).toBe('false');
    expect(screen.getByTestId('genres').textContent).toBe('0');
  });
});
