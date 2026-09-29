import type { NavigateFunction } from 'react-router';
import { useAuthStore } from '@/store/authStore';
import { getLibraryBrowseScope } from '@/lib/library/libraryBrowseScope';
import { artistBrowseRestoreNavigationState } from '@/lib/navigation/albumDetailNavigation';
import {
  DEFAULT_ARTIST_BROWSE_RETURN_STATE,
  useArtistBrowseSessionStore,
} from '@/features/artist/store/artistBrowseSessionStore';
import { useArtistViewModeStore } from '@/features/artist/store/artistViewModeStore';

/**
 * Opens Artists with its favourites filter switched on — the artists twin of
 * `openFavoriteAlbums`.
 *
 * The filter travels the way the artists page already reads one: a return stash
 * plus the `artistBrowseRestore` flag. The stash is keyed by the server the page
 * browses from — the anchor of the browse scope, which is not the active server
 * when several servers are selected.
 *
 * The letter and text filters go in as their defaults: this is a fresh view of
 * the favourites. Credit mode, view mode and artist images are the viewer's
 * settings, not filters; the page restores them from the stash too, so they go
 * in as they are now.
 */
export function openFavoriteArtists(navigate: NavigateFunction): void {
  const auth = useAuthStore.getState();
  const serverId = getLibraryBrowseScope().anchorServerId ?? auth.activeServerId ?? '';
  if (serverId) {
    useArtistBrowseSessionStore.getState().stashReturnState(serverId, {
      ...DEFAULT_ARTIST_BROWSE_RETURN_STATE,
      starredOnly: true,
      creditMode: auth.artistBrowseCreditMode,
      viewMode: useArtistViewModeStore.getState().viewMode,
      showArtistImages: auth.showArtistImages,
    });
  }
  navigate('/artists', { state: artistBrowseRestoreNavigationState() });
}
