import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';

const { searchForServerMock } = vi.hoisted(() => ({ searchForServerMock: vi.fn() }));

vi.mock('@/lib/api/subsonicSearch', () => ({
  search: vi.fn(),
  searchForServer: searchForServerMock,
}));
vi.mock('@/features/album/components/AlbumCard', () => ({
  default: ({ album }: { album: { name: string } }) => <div>album: {album.name}</div>,
}));
vi.mock('@/ui/VirtualCardGrid', () => ({
  VirtualCardGrid: ({ items, renderItem }: { items: unknown[]; renderItem: (item: unknown) => React.ReactNode }) => (
    <div>{items.map((item, i) => <div key={i}>{renderItem(item)}</div>)}</div>
  ),
}));

import { ndClearTokenCache } from '@/lib/api/navidromeBrowse';
import { useAuthStore } from '@/store/authStore';
import { makeServer } from '@/test/helpers/factories';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { onInvoke } from '@/test/mocks/tauri';

import LabelAlbums from './LabelAlbums';

function renderLabel(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/label/:name" element={<LabelAlbums />} />
    </Routes>,
    { route },
  );
}

describe('LabelAlbums', () => {
  beforeEach(() => {
    resetAuthStore();
    ndClearTokenCache();
    searchForServerMock.mockReset();
    const server = makeServer({ id: 's1' });
    useAuthStore.setState({ servers: [server], activeServerId: server.id });
    onInvoke('navidrome_login', () => ({ token: 'jwt', userId: 'u', isAdmin: false }));
  });

  it('lists exact label matches through the tag id', async () => {
    const calls: Array<Record<string, unknown>> = [];
    onInvoke('nd_list_albums_by_tag', args => {
      calls.push(args as Record<string, unknown>);
      return { items: [{ id: 'a1', name: 'Bright Future' }, { id: 'a2', name: 'Classic Objects' }], total: 2 };
    });

    renderLabel('/label/4AD?id=tag-4ad&server=s1');

    expect(await screen.findByText('album: Bright Future')).toBeInTheDocument();
    expect(screen.getByText('album: Classic Objects')).toBeInTheDocument();
    expect(screen.getByText('2 albums')).toBeInTheDocument();
    expect(calls[0]).toEqual(expect.objectContaining({ tagName: 'recordlabel', tagId: 'tag-4ad' }));
    expect(searchForServerMock).not.toHaveBeenCalled();
  });

  it('resolves the tag id from the name when the link has none', async () => {
    onInvoke('nd_list_tags', () => [
      { id: 'tag-4ad-x', tagName: 'recordlabel', tagValue: '4AD / Beat Records' },
      { id: 'tag-4ad', tagName: 'recordlabel', tagValue: '4ad' },
    ]);
    onInvoke('nd_list_albums_by_tag', args => {
      const { tagId } = args as { tagId: string };
      return { items: [{ id: 'a1', name: `from ${tagId}` }], total: 1 };
    });

    renderLabel('/label/4AD?server=s1');

    expect(await screen.findByText('album: from tag-4ad')).toBeInTheDocument();
  });

  it('falls back to search when the native tag API is unavailable', async () => {
    onInvoke('nd_list_tags', () => { throw new Error('HTTP 404 Not Found'); });
    searchForServerMock.mockResolvedValue({
      albums: [
        { id: 'a1', name: 'On Label', recordLabel: 'Warp' },
        { id: 'a2', name: 'Other Hit', recordLabel: 'Ninja Tune' },
      ],
      artists: [],
      songs: [],
    });

    renderLabel('/label/Warp?server=s1');

    expect(await screen.findByText('album: On Label')).toBeInTheDocument();
    expect(screen.queryByText('album: Other Hit')).not.toBeInTheDocument();
  });
});
