import type { NavigateFunction } from 'react-router';
import { useAuthStore } from '@/store/authStore';
import { albumBrowseRestoreNavigationState } from '@/lib/navigation/albumDetailNavigation';
import {
  DEFAULT_ALBUM_BROWSE_RETURN_FILTERS,
  useAlbumBrowseSessionStore,
} from '@/features/album/store/albumBrowseSessionStore';

/**
 * Opens All Albums with its favourites filter switched on (#1556).
 *
 * The filter travels the way the albums page already reads one: a return stash
 * plus the `albumBrowseRestore` flag. Handing the value in any other way does
 * not survive arrival — on a forward navigation the page clears every filter it
 * was not told to restore, which would switch this one straight back off.
 *
 * The other filters are written as their defaults on purpose: this is a fresh
 * view of the favourites, not a return to a previous browse.
 */
export function openFavoriteAlbums(navigate: NavigateFunction): void {
  const serverId = useAuthStore.getState().activeServerId ?? '';
  if (serverId) {
    useAlbumBrowseSessionStore.getState().stashReturnFilters(serverId, 'albums', {
      ...DEFAULT_ALBUM_BROWSE_RETURN_FILTERS,
      starredOnly: true,
      searchQuery: '',
    });
  }
  navigate('/albums', { state: albumBrowseRestoreNavigationState() });
}
