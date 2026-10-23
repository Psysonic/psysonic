import { create } from 'zustand';

import type { ArtistAlbumOrder } from '@/features/artist/utils/sortArtistAlbums';

export const DEFAULT_ARTIST_ALBUM_ORDER: ArtistAlbumOrder = 'yearDesc';

interface ArtistAlbumSortStore {
  orderByServer: Record<string, ArtistAlbumOrder>;
  orderFor: (serverId: string) => ArtistAlbumOrder;
  setOrder: (serverId: string, order: ArtistAlbumOrder) => void;
}

export const useArtistAlbumSortStore = create<ArtistAlbumSortStore>((set, get) => ({
  orderByServer: {},

  orderFor: (serverId) =>
    get().orderByServer[serverId] ?? DEFAULT_ARTIST_ALBUM_ORDER,

  setOrder: (serverId, order) => {
    if (!serverId) return;
    set(s => ({
      orderByServer: { ...s.orderByServer, [serverId]: order },
    }));
  },
}));
