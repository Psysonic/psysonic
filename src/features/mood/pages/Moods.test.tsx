import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useParams } from 'react-router';

import { useAuthStore } from '@/store/authStore';
import { makeServer } from '@/test/helpers/factories';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { onInvoke } from '@/test/mocks/tauri';

import Moods from './Moods';

function MoodRouteProbe() {
  const { name } = useParams<{ name: string }>();

  return (
    <div>
      Mood detail: {decodeURIComponent(name ?? '')}
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
    resetAuthStore();

    const server = makeServer({ id: 's1' });

    useAuthStore.setState({
      servers: [server],
      activeServerId: server.id,
    });
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