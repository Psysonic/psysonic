import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';

import { useAuthStore } from '@/store/authStore';
import { makeServer } from '@/test/helpers/factories';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAuthStore } from '@/test/helpers/storeReset';

const hoisted = vi.hoisted(() => ({
  useMoodAlbumBrowse: vi.fn(),
  useMoodTrackBrowse: vi.fn(),
  fetchMoodAlbumTotal: vi.fn(),
}));

vi.mock('../hooks/useMoodAlbumBrowse', () => ({
  useMoodAlbumBrowse: hoisted.useMoodAlbumBrowse,
}));

vi.mock('../hooks/useMoodTrackBrowse', () => ({
  useMoodTrackBrowse: hoisted.useMoodTrackBrowse,
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

vi.mock('@/features/search/components/PagedSongList', () => ({
  default: ({
    songs,
  }: {
    songs: Array<{ id: string; title: string }>;
  }) => (
    <div>
      {songs.map(song => (
        <div key={song.id}>{song.title}</div>
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
  sessionReady: true,
  loadingMore: false,
  hasMore: false,
  loadMore: vi.fn(),
  bindLoadMoreSentinel: vi.fn(),
};

const emptyTrackBrowseResult = {
  songs: [],
  total: null,
  loading: false,
  sessionReady: true,
  loadingMore: false,
  hasMore: false,
  loadMore: vi.fn(),
};

function renderMoodDetail(
  mood = 'Atmospheric',
  search = '',
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
      route: `/moods/${encodeURIComponent(mood)}${search}`,
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
    hoisted.useMoodTrackBrowse.mockReset();
    hoisted.fetchMoodAlbumTotal.mockReset();

    hoisted.useMoodAlbumBrowse.mockReturnValue(
      emptyBrowseResult,
    );
    hoisted.useMoodTrackBrowse.mockReturnValue(
      emptyTrackBrowseResult,
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
        screen.getByText(/2 albums/),
      ).toBeInTheDocument();
    });

    const calls = hoisted.useMoodTrackBrowse.mock.calls;

     expect(
      calls[calls.length - 1]?.[3],
    ).toBe(false);
  });

  it('switches to the track view and renders matching tracks', async () => {
    const user = userEvent.setup();

    hoisted.useMoodTrackBrowse.mockImplementation((...args) => (
      args[3]
        ? {
            ...emptyTrackBrowseResult,
            songs: [
              { id: 'track-1', title: 'Neon Rain' },
              { id: 'track-2', title: 'After Midnight' },
            ],
            total: 2,
          }
        : emptyTrackBrowseResult
    ));

    renderMoodDetail('Night Drive');

    await user.click(
      screen.getByRole('tab', {
        name: 'Tracks',
      }),
    );

    expect(
      await screen.findByText('Neon Rain'),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('tab', {
        name: 'Tracks',
      }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByText(/2 tracks/),
    ).toBeInTheDocument();
  });

  it('keeps the Albums browse session active after switching to Tracks', async () => {
    const user = userEvent.setup();

    renderMoodDetail('Night Drive');

    await user.click(
      screen.getByRole('tab', {
        name: 'Tracks',
      }),
    );

    const calls = hoisted.useMoodAlbumBrowse.mock.calls;
    expect(
      calls[calls.length - 1]?.[1],
    ).toBe('Night Drive');
  });

  it('does not start Albums in the background on a direct Tracks view', () => {
    renderMoodDetail('Night Drive', '?view=tracks');

    const calls = hoisted.useMoodAlbumBrowse.mock.calls;
    expect(
      calls[calls.length - 1]?.[1],
    ).toBe('');
  });

  it('restores independent scroll positions when switching tabs', async () => {
    const user = userEvent.setup();

    hoisted.useMoodAlbumBrowse.mockReturnValue({
      ...emptyBrowseResult,
      albums: [
        { id: 'album-1', name: 'Album One' },
        { id: 'album-2', name: 'Album Two' },
      ],
      displayAlbums: [
        { id: 'album-1', name: 'Album One' },
        { id: 'album-2', name: 'Album Two' },
      ],
    });
    hoisted.useMoodTrackBrowse.mockReturnValue({
      ...emptyTrackBrowseResult,
      songs: [
        { id: 'track-1', title: 'Track One' },
        { id: 'track-2', title: 'Track Two' },
      ],
      total: 2,
    });

    renderMoodDetail('Night Drive');

    const viewport =
      document.getElementById(
        'mood-detail-inpage-scroll-viewport',
      );
    expect(viewport).not.toBeNull();
    if (!viewport) return;

    viewport.scrollTop = 320;
    fireEvent.scroll(viewport);

    await user.click(
      screen.getByRole('tab', {
        name: 'Tracks',
      }),
    );

    await waitFor(() => {
      expect(viewport.scrollTop).toBe(0);
    });

    viewport.scrollTop = 740;
    fireEvent.scroll(viewport);

    await user.click(
      screen.getByRole('tab', {
        name: 'Albums',
      }),
    );

    await waitFor(() => {
      expect(viewport.scrollTop).toBe(320);
    });

    await user.click(
      screen.getByRole('tab', {
        name: 'Tracks',
      }),
    );

    await waitFor(() => {
      expect(viewport.scrollTop).toBe(740);
    });
  });

  it('renders mood names containing a percent sign', () => {
    renderMoodDetail('100%');

    expect(
      screen.getByRole('heading', {
        name: '100%',
      }),
    ).toBeInTheDocument();
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