import {
  useEffect,
  useMemo,
  useRef,
  type RefObject,
} from 'react';
import {
  useLocation,
  useNavigationType,
} from 'react-router';

import {
  MOOD_DETAIL_INPAGE_SCROLL_VIEWPORT_ID,
  readInpageScrollTop,
} from '@/constants/appScroll';
import {
  DEFAULT_ALBUM_BROWSE_RETURN_FILTERS,
  albumBrowseSortForServer,
  clearMoodDetailReturnStash,
  isAlbumDetailPath,
  isArtistDetailPath,
  isMoodDetailPath,
  moodDetailMoodFromPath,
  peekMoodDetailScrollRestore,
  stashMoodDetailReturnFilters,
  useAlbumBrowseSessionStore,
  type AlbumBrowseScrollSnapshot,
} from '@/features/album';
import {
  shouldRestoreAlbumBrowseSession,
} from '@/lib/navigation/albumDetailNavigation';

/**
 * Mood detail: locked mood filter + leave/restore
 * session, matching GenreDetail.
 */
export function useMoodDetailBrowse(
  serverId: string,
  moodName: string,
  scrollSnapshotRef?: RefObject<AlbumBrowseScrollSnapshot>,
) {
  const navigationType = useNavigationType();
  const location = useLocation();

  const sort = useAlbumBrowseSessionStore(state =>
    albumBrowseSortForServer(
      state.sortByServer,
      serverId,
    ),
  );

  const restoredFromStashRef =
    useRef(false);

  const restoreSnapshot = useMemo(
    () => ({
      displayCount:
        peekMoodDetailScrollRestore(
          serverId,
          moodName,
        )?.displayCount,
      view:
        new URLSearchParams(
          location.search,
        ).get('view') === 'tracks'
          ? 'tracks' as const
          : 'albums' as const,
    }),
    [
      serverId,
      moodName,
      location.search,
    ],
  );

  useEffect(() => {
    restoredFromStashRef.current = false;
  }, [serverId, moodName]);

  useEffect(() => {
    if (!serverId || !moodName) return;

    if (
      shouldRestoreAlbumBrowseSession(
        navigationType,
        location.state,
      )
    ) {
      restoredFromStashRef.current = true;
      return;
    }

    if (restoredFromStashRef.current) {
      return;
    }

    clearMoodDetailReturnStash(
      serverId,
      moodName,
    );
  }, [
    serverId,
    moodName,
    navigationType,
    location.state,
  ]);

  useEffect(() => {
    return () => {
      if (!serverId || !moodName) return;

      const path =
        window.location.pathname;

      if (
        isAlbumDetailPath(path) ||
        isArtistDetailPath(path)
      ) {
        // Read at cleanup time on purpose: we want the scroll snapshot as it is
        // at navigation-away. Copying it at effect setup would stash a stale value.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        const snapshot = scrollSnapshotRef?.current;

        const scrollTop = Math.max(
          readInpageScrollTop(
            MOOD_DETAIL_INPAGE_SCROLL_VIEWPORT_ID,
          ),
          snapshot?.scrollTop ?? 0,
        );

        stashMoodDetailReturnFilters(
          serverId,
          moodName,
          {
            ...DEFAULT_ALBUM_BROWSE_RETURN_FILTERS,
            scrollTop,
            displayCount:
              snapshot?.displayCount,
          },
        );
      } else if (
        !isMoodDetailPath(path) ||
        moodDetailMoodFromPath(path) !==
          moodName
      ) {
        clearMoodDetailReturnStash(
          serverId,
          moodName,
        );
      }
    };
  }, [
    serverId,
    moodName,
    scrollSnapshotRef,
  ]);

  return {
    sort,
    restoreDisplayCount:
      restoreSnapshot.displayCount,
    // The saved count belongs to whichever tab was visible when detail navigation began.
    restoreView: restoreSnapshot.view,
  };
}