import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_ARTIST_ALBUM_ORDER,
  useArtistAlbumSortStore,
} from '@/features/artist/store/artistAlbumSortStore';

describe('artistAlbumSortStore', () => {
  beforeEach(() => {
    useArtistAlbumSortStore.setState({ orderByServer: {} });
  });

  it('defaults to newest first per server', () => {
    expect(useArtistAlbumSortStore.getState().orderFor('s1')).toBe(DEFAULT_ARTIST_ALBUM_ORDER);
  });

  it('keeps the chosen order per server independently', () => {
    const { setOrder, orderFor } = useArtistAlbumSortStore.getState();
    setOrder('s1', 'nameAsc');
    expect(orderFor('s1')).toBe('nameAsc');
    expect(orderFor('s2')).toBe('yearDesc');
  });

  it('ignores an empty server id', () => {
    useArtistAlbumSortStore.getState().setOrder('', 'nameDesc');
    expect(useArtistAlbumSortStore.getState().orderByServer).toEqual({});
  });
});
