import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useNavigate, useParams } from 'react-router';
import { APP_MAIN_SCROLL_VIEWPORT_ID } from '@/constants/appScroll';

import { useAuthStore } from '@/store/authStore';
import { makeServer } from '@/test/helpers/factories';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { onInvoke } from '@/test/mocks/tauri';

import Moods from './Moods';

function MoodRouteProbe() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  return (
    <div>
      Mood detail: {name ?? ''}
      <button onClick={() => navigate(-1)}>Return to catalog</button>
    </div>
  );
}

function renderMoods() {
  return renderWithProviders(
    <Routes>
      <Route path="/moods" element={<Moods />} />
      <Route
        path="/moods/:name"
        element={<MoodRouteProbe />}
      />
    </Routes>,
    { route: '/moods' },
  );
}

describe('Moods', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetAuthStore();

    const server = makeServer({ id: 's1' });

    useAuthStore.setState({
      servers: [server],
      activeServerId: server.id,
    });
  });

  it('searches and sorts locally, retaining the sort on remount', async () => {
    const load = vi.fn(() => [
      { value: 'Zippy', albumCount: 100, songCount: 100 },
      { value: 'Calm', albumCount: 2, songCount: 2 },
    ]);
    onInvoke('library_get_mood_album_counts', load);
    const view = renderMoods();
    const calm = await screen.findByRole('button', { name: 'Calm' });
    const size = calm.style.fontSize;
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sort moods' }));
    await user.click(screen.getByRole('option', { name: 'Alphabetical' }));
    expect([...document.querySelectorAll('.genre-pill')].map(el => el.textContent)).toEqual(['Calm', 'Zippy']);
    const input = screen.getByRole('searchbox', { name: 'Search moods' });
    fireEvent.change(input, { target: { value: 'CAL' } });
    expect(screen.queryByRole('button', { name: 'Zippy' })).not.toBeInTheDocument();
    expect(calm.style.fontSize).toBe(size);
    expect(screen.getByText('1 of 2 Moods')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'missing' } });
    expect(screen.getByText('No moods match “missing”.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear mood search' }));
    expect(load).toHaveBeenCalledTimes(1);
    view.unmount();
    renderMoods();
    await screen.findByRole('button', { name: 'Calm' });
    expect([...document.querySelectorAll('.genre-pill')].map(el => el.textContent)).toEqual(['Calm', 'Zippy']);
  });

  it('restores the filtered catalog and scroll after a detail round trip', async () => {
    onInvoke('library_get_mood_album_counts', () => [
      { value: 'Dreamy', albumCount: 10, songCount: 10 },
      { value: 'Energetic', albumCount: 2, songCount: 2 },
    ]);
    const viewport = document.createElement('div');
    viewport.id = APP_MAIN_SCROLL_VIEWPORT_ID;
    document.body.appendChild(viewport);
    try {
      renderMoods();
      await screen.findByRole('button', { name: 'Dreamy' });
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'dream' } });
      viewport.scrollTop = 420;
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Dreamy' }));
      viewport.scrollTop = 0;
      await user.click(screen.getByRole('button', { name: 'Return to catalog' }));
      await screen.findByRole('button', { name: 'Dreamy' });
      expect(screen.getByRole('searchbox')).toHaveValue('dream');
      expect(screen.queryByRole('button', { name: 'Energetic' })).not.toBeInTheDocument();
      await waitFor(() => expect(viewport.scrollTop).toBe(420));
    } finally {
      viewport.remove();
    }
  });

  it('renders the mood cloud and mood count', async () => {
    onInvoke('library_get_mood_album_counts', () => [
      {
        value: 'Atmospheric',
        albumCount: 12,
        songCount: 30,
      },
      {
        value: 'Dreamy',
        albumCount: 4,
        songCount: 9,
      },
    ]);

    renderMoods();

    expect(
      await screen.findByRole('button', {
        name: 'Atmospheric',
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('button', {
        name: 'Dreamy',
      }),
    ).toBeInTheDocument();

    const heading = screen.getByRole('heading', {
      name: 'Moods',
    });

    expect(heading.parentElement).toHaveTextContent(
      '2 Moods',
    );
  });

  it('weights moods with more albums more heavily', async () => {
    onInvoke('library_get_mood_album_counts', () => [
      {
        value: 'Atmospheric',
        albumCount: 100,
        songCount: 150,
      },
      {
        value: 'Sparse',
        albumCount: 2,
        songCount: 2,
      },
    ]);

    renderMoods();

    const atmospheric =
      await screen.findByRole('button', {
        name: 'Atmospheric',
      });

    const sparse = screen.getByRole('button', {
      name: 'Sparse',
    });

    expect(
      Number.parseFloat(atmospheric.style.fontSize),
    ).toBeGreaterThan(
      Number.parseFloat(sparse.style.fontSize),
    );
  });

  it('uses a singular label when only one mood is available', async () => {
    onInvoke('library_get_mood_album_counts', () => [
      { value: 'Dreamy', albumCount: 4, songCount: 9 },
    ]);

    renderMoods();

    await screen.findByRole('button', { name: 'Dreamy' });
    expect(screen.getByRole('heading', { name: 'Moods' }).parentElement)
      .toHaveTextContent('1 Mood');
  });

  it('shows the empty state when no moods are indexed', async () => {
    onInvoke('library_get_mood_album_counts', () => []);

    renderMoods();

    expect(
      await screen.findByText('No moods found.'),
    ).toBeInTheDocument();
  });

  it('navigates to the selected mood', async () => {
    const user = userEvent.setup();

    onInvoke('library_get_mood_album_counts', () => [
      {
        value: 'Night Drive',
        albumCount: 8,
        songCount: 15,
      },
    ]);

    renderMoods();

    await user.click(
      await screen.findByRole('button', {
        name: 'Night Drive',
      }),
    );

    expect(
      await screen.findByText(
        'Mood detail: Night Drive',
      ),
    ).toBeInTheDocument();
  });
});
