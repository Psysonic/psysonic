import { api, apiForServer } from '@/lib/api/subsonicClient';
import type { AlbumInfo } from '@/lib/api/subsonicTypes';

export async function getAlbumInfo2(albumId: string): Promise<AlbumInfo | null> {
  try {
    const data = await api<{ albumInfo: AlbumInfo }>('getAlbumInfo2.view', { id: albumId });
    return data.albumInfo ?? null;
  } catch {
    return null;
  }
}

/**
 * Same call against a named server instead of the active one.
 *
 * The album detail page needs this rather than `getAlbumInfo2`: under
 * multi-server the album on screen often belongs to a server that is not the
 * active one, and asking the active server for its id returns either nothing or
 * — worse — a different album that happens to share the id. The page already
 * resolves the owning server for its artist bio; this reuses it.
 */
export async function getAlbumInfoForServer(
  serverId: string,
  albumId: string,
  timeout?: number,
): Promise<AlbumInfo | null> {
  try {
    const data = await apiForServer<{ albumInfo: AlbumInfo }>(
      serverId,
      'getAlbumInfo2.view',
      { id: albumId },
      timeout,
    );
    return data.albumInfo ?? null;
  } catch {
    return null;
  }
}
