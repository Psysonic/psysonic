import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';

import { useAuthStore } from '@/store/authStore';
import { makeServer } from '@/test/helpers/factories';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAuthStore } from '@/test/helpers/storeReset';

const hoisted = vi.hoisted(() => ({
  useLabelAlbumBrowse: vi.fn(),
  fetchLabelAlbumTotal: vi.fn(),
}));

vi.mock('../hooks/useLabelAlbumBrowse', () => ({
  useLabelAlbumBrowse: hoisted.useLabelAlbumBrowse,
}));

vi.mock('@/lib/library/labelAlbumBrowse', async () => {
  const actual = await vi.importActual<typeof import('@/lib/library/labelAlbumBrowse')>(
    '@/lib/library/labelAlbumBrowse',
  );
  return { ...actual, fetchLabelAlbumTotal: hoisted.fetchLabelAlbumTotal };
});

vi.mock('@/ui/VirtualCardGrid', () => ({
  VirtualCardGrid: ({
    items,
    renderItem,
  }: {
    items: Array<{ id: string }>;
    renderItem: (item: { id: string }, index: number) => React.ReactNode;
  }) => <div>{items.map((item, index) => <div key={item.id}>{renderItem(item, index)}</div>)}</div>,
}));

vi.mock('@/features/album', async () => {
  const actual = await vi.importActual<typeof import('@/features/album')>('@/features/album');
  return { ...actual, AlbumCard: ({ album }: { album: { name: string } }) => <div>{album.name}</div> };
});

import LabelDetail from './LabelDetail';

const emptyBrowseResult = {
  albums: [],
  displayAlbums: [],
  loading: false,
  loadingMore: false,
  hasMore: false,
  loadMore: vi.fn(),
  bindLoadMoreSentinel: vi.fn(),
};

const twoAlbums = [
  { id: 'album-1', name: 'Selected Ambient Works' },
  { id: 'album-2', name: 'Music Has the Right' },
];

function renderLabelDetail(label = 'Warp') {
  return renderWithProviders(
    <Routes>
      <Route path="/label/:name" element={<LabelDetail />} />
      <Route path="/labels" element={<div>Labels page</div>} />
    </Routes>,
    { route: `/label/${encodeURIComponent(label)}` },
  );
}

describe('LabelDetail', () => {
  beforeEach(() => {
    resetAuthStore();
    const server = makeServer({ id: 's1' });
    useAuthStore.setState({ servers: [server], activeServerId: server.id });
    hoisted.useLabelAlbumBrowse.mockReset();
    hoisted.fetchLabelAlbumTotal.mockReset();
    hoisted.useLabelAlbumBrowse.mockReturnValue(emptyBrowseResult);
    hoisted.fetchLabelAlbumTotal.mockResolvedValue(null);
  });

  it('renders the label and counts the albums once every page is loaded', () => {
    hoisted.useLabelAlbumBrowse.mockReturnValue({
      ...emptyBrowseResult,
      albums: twoAlbums,
      displayAlbums: twoAlbums,
    });
    renderLabelDetail('Warp');

    expect(screen.getByRole('heading', { name: 'Warp' })).toBeInTheDocument();
    expect(screen.getByText('Selected Ambient Works')).toBeInTheDocument();
    expect(screen.getByText('2 albums')).toBeInTheDocument();
    expect(hoisted.fetchLabelAlbumTotal).not.toHaveBeenCalled();
  });

  it('asks the index for the total while more pages remain', async () => {
    hoisted.useLabelAlbumBrowse.mockReturnValue({
      ...emptyBrowseResult,
      albums: twoAlbums,
      displayAlbums: twoAlbums,
      hasMore: true,
    });
    hoisted.fetchLabelAlbumTotal.mockResolvedValue(340);
    renderLabelDetail('Warp');

    await waitFor(() => expect(screen.getByText('340 albums')).toBeInTheDocument());
    expect(hoisted.fetchLabelAlbumTotal).toHaveBeenCalledWith(
      's1', 'Warp', true, expect.anything(), expect.objectContaining({ anchorServerId: 's1' }),
    );
  });

  it('browses every server in the library scope', () => {
    const second = makeServer({ id: 's2' });
    useAuthStore.setState(s => ({
      servers: [...s.servers, second],
      libraryBrowseServerIds: ['s1', 's2'],
      libraryBrowseSelectionByServer: { s2: ['lib-9'] },
    }));
    renderLabelDetail('Warp');

    const calls = hoisted.useLabelAlbumBrowse.mock.calls;
    const browseScope = calls[calls.length - 1]?.[5];
    expect(browseScope.pairs).toEqual([
      { serverId: 's1', libraryId: null },
      { serverId: 's2', libraryId: 'lib-9' },
    ]);
  });

  it('shows the empty state when no albums match', async () => {
    renderLabelDetail('Nobody');
    expect(await screen.findByText('No albums found for this label.')).toBeInTheDocument();
  });

  it('returns to the labels page', async () => {
    const user = userEvent.setup();
    renderLabelDetail();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Labels page')).toBeInTheDocument();
  });
});
