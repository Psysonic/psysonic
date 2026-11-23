import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { onInvoke, invokeMock } from '@/test/mocks/tauri';
import { makeSubsonicSong } from '@/test/helpers/factories';
import { resetPlayerStore } from '@/test/helpers/storeReset';
import { usePlayerStore } from '@/features/playback';
import { useLibraryIndexStore } from '@/store/libraryIndexStore';
import type { SubsonicAlbum, SubsonicSong } from '@/lib/api/subsonicTypes';
import type { ResolvedAlbum } from '@/store/mediaResolver';

vi.mock('@/lib/api/subsonicLibrary', () => ({ getAlbumForServer: vi.fn() }));
vi.mock('@/lib/network/subsonicNetworkGuard', () => ({ shouldAttemptSubsonicForServer: () => true }));

import { getAlbumForServer } from '@/lib/api/subsonicLibrary';
import { useAlbumServerMetadataReconcile } from '@/features/album/hooks/useAlbumServerMetadataReconcile';

const SID = 's1';
const album: SubsonicAlbum = {
  id: 'al1',
  name: 'Album',
  artist: 'Artist',
  artistId: 'ar1',
  songCount: 3,
  duration: 540,
  serverId: SID,
};

function song(id: string, userRating?: number): SubsonicSong {
  return makeSubsonicSong({ id, albumId: album.id, serverId: SID, userRating });
}

/** Painted from a stale index: t1 unrated, t2 at 2, t3 at 5. */
function staleIndexAlbum(): ResolvedAlbum {
  return { album, songs: [song('t1'), song('t2', 2), song('t3', 5)] };
}

function renderReconcile(initial: ResolvedAlbum) {
  return renderHook(() => {
    const [state, setState] = useState<ResolvedAlbum | null>(initial);
    const userMutationInFlightRef = useRef(false);
    useAlbumServerMetadataReconcile({
      serverId: SID,
      albumId: album.id,
      album: state?.album,
      songs: state?.songs,
      setAlbum: setState,
      enabled: true,
      userMutationInFlightRef,
    });
    return state;
  });
}

describe('useAlbumServerMetadataReconcile track ratings', () => {
  beforeEach(() => {
    vi.mocked(getAlbumForServer).mockReset();
    resetPlayerStore();
    useLibraryIndexStore.setState({ masterEnabled: true });
    onInvoke('library_patch_track', () => undefined);
    onInvoke('library_patch_album', () => undefined);
    // The server holds ratings set by another client: t1 = 4, t2 = 3, t3 unchanged.
    vi.mocked(getAlbumForServer).mockResolvedValue({
      album,
      songs: [song('t1', 4), song('t2', 3), song('t3', 5)],
    });
  });

  it('shows the server ratings and writes them back to the index', async () => {
    const { result } = renderReconcile(staleIndexAlbum());

    await waitFor(() => expect(result.current?.songs.map(s => s.userRating)).toEqual([4, 3, 5]));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    expect(invokeMock).toHaveBeenCalledWith('library_patch_track', {
      serverId: SID,
      trackId: 't1',
      patch: { userRating: 4 },
    });
    expect(invokeMock).toHaveBeenCalledWith('library_patch_track', {
      serverId: SID,
      trackId: 't2',
      patch: { userRating: 3 },
    });
    expect(getAlbumForServer).toHaveBeenCalledWith(SID, album.id, { mirrorToIndex: false });
  });

  it('keeps a rating the user set this session', async () => {
    usePlayerStore.getState().setUserRatingOverride(`${SID}:t2`, 1);
    const { result } = renderReconcile(staleIndexAlbum());

    await waitFor(() => expect(result.current?.songs[0].userRating).toBe(4));
    expect(result.current?.songs[1].userRating).toBe(2);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(invokeMock).not.toHaveBeenCalledWith('library_patch_track', expect.objectContaining({ trackId: 't2' }));
  });

  it('leaves the page and the index alone when nothing drifted', async () => {
    vi.mocked(getAlbumForServer).mockResolvedValue({ album, songs: staleIndexAlbum().songs });
    const initial = staleIndexAlbum();
    const { result } = renderReconcile(initial);

    await waitFor(() => expect(getAlbumForServer).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(result.current).toBe(initial);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
