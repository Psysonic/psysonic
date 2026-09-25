import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';

import { useAuthStore } from '@/store/authStore';
import { makeServer } from '@/test/helpers/factories';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAuthStore } from '@/test/helpers/storeReset';

const hoisted = vi.hoisted(() => ({
  useMoodAlbumBrowse: vi.fn(),
  fetchMoodAlbumTotal: vi.fn(),
}));

vi.mock('../hooks/useMoodAlbumBrowse', () => ({
  useMoodAlbumBrowse: hoisted.useMoodAlbumBrowse,
}));

vi.mock('@/lib/library/moodAlbumBrowse', async () => {
  const actual =
    await vi.importActual<
      typeof import('@/lib/library/moodAlbumBrowse')
    >('@/lib/library/moodAlbumBrowse');

  return {
    ...actual,
    fetchMoodAlbumTotal:
      hoisted.fetchMoodAlbumTotal,
  };
});

vi.mock('@/ui/VirtualCardGrid', () => ({
  VirtualCardGrid: ({
    items,
    renderItem,
  }: {
    items: Array<{ id: string }>;
    renderItem: (
      item: { id: string },
      index: number,
    ) => React.ReactNode;
  }) => (
    <div>
      {items.map((item, index) => (
        <div key={item.id}>
          {renderItem(item, index)}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@/features/album', async () => {
  const actual =
    await vi.importActual<
      typeof import('@/features/album')
    >('@/features/album');

  return {
    ...actual,
    AlbumCard: ({
      album,
    }: {
      album: { name: string };
    }) => <div>{album.name}</div>,
  };
});

import MoodDetail from './MoodDetail';

const emptyBrowseResult = {
  albums: [],
  displayAlbums: [],
  loading: false,
  loadingMore: false,
  hasMore: false,
  loadMore: vi.fn(),
  bindLoadMoreSentinel: vi.fn(),
};

function renderMoodDetail(
  mood = 'Atmospheric',
) {
  return renderWithProviders(
    <Routes>
      <Route
        path="/moods/:name"
        element={<MoodDetail />}
      />
      <Route
        path="/moods"
        element={<div>Moods page</div>}
      />
    </Routes>,
    {
      route: `/moods/${encodeURIComponent(mood)}`,
    },
  );
}

describe('MoodDetail', () => {
  beforeEach(() => {
    resetAuthStore();

    const server = makeServer({
      id: 's1',
    });

    useAuthStore.setState({
      servers: [server],
      activeServerId: server.id,
    });

    hoisted.useMoodAlbumBrowse.mockReset();
    hoisted.fetchMoodAlbumTotal.mockReset();

    hoisted.useMoodAlbumBrowse.mockReturnValue(
      emptyBrowseResult,
    );

    hoisted.fetchMoodAlbumTotal.mockResolvedValue(
      null,
    );
  });

  it('renders the selected mood and matching albums', async () => {
    hoisted.useMoodAlbumBrowse.mockReturnValue({
      ...emptyBrowseResult,
      albums: [
        {
          id: 'album-1',
          name: 'Midnight Signals',
        },
        {
          id: 'album-2',
          name: 'Afterglow',
        },
      ],
      displayAlbums: [
        {
          id: 'album-1',
          name: 'Midnight Signals',
        },
        {
          id: 'album-2',
          name: 'Afterglow',
        },
      ],
    });

    hoisted.fetchMoodAlbumTotal.mockResolvedValue(2);

    renderMoodDetail('Night Drive');

    expect(
      screen.getByRole('heading', {
        name: 'Night Drive',
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByText('Midnight Signals'),
    ).toBeInTheDocument();

    expect(
      screen.getByText('Afterglow'),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText('2 albums'),
      ).toBeInTheDocument();
    });
  });

  it('shows the empty state when no albums match', async () => {
    renderMoodDetail('Sparse');

    expect(
      await screen.findByText(
        'No albums found for this mood.',
      ),
    ).toBeInTheDocument();
  });

  it('returns to the moods page', async () => {
    const user = userEvent.setup();

    renderMoodDetail();

    await user.click(
      screen.getByRole('button', {
        name: 'Back',
      }),
    );

    expect(
      await screen.findByText('Moods page'),
    ).toBeInTheDocument();
  });
});