import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';

const hookResult = vi.hoisted(() => ({ current: { albums: [] as SubsonicAlbum[], loading: false } }));

vi.mock('@/features/album/hooks/useAlbumSimilarAlbums', () => ({
  useAlbumSimilarAlbums: () => hookResult.current,
}));
vi.mock('@/features/album/components/AlbumRow', () => ({
  default: ({ title, albums }: { title: string; albums: SubsonicAlbum[] }) => (
    <section aria-label={title}>{albums.map(a => <span key={a.id}>{a.name}</span>)}</section>
  ),
}));

import SimilarAlbumsRail from '@/features/album/components/SimilarAlbumsRail';

const props = { serverId: 'srv-a', albumId: 'cur', artistId: 'me', songs: [], enabled: true };

describe('SimilarAlbumsRail', () => {
  beforeEach(() => {
    hookResult.current = { albums: [], loading: false };
  });

  it('renders nothing without albums', () => {
    const { container } = renderWithProviders(<SimilarAlbumsRail {...props} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the rail with the similar albums', () => {
    hookResult.current = {
      albums: [{ id: 'a', name: 'Other Album', artist: 'X', artistId: 'x', songCount: 0, duration: 0 }],
      loading: false,
    };
    renderWithProviders(<SimilarAlbumsRail {...props} />);
    expect(screen.getByRole('region', { name: 'Similar albums' })).toHaveTextContent('Other Album');
  });
});
