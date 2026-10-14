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
  clearMoodDetailTabScrollSnapshots,
  isAlbumDetailPath,
  isArtistDetailPath,
  isMoodDetailPath,
  moodDetailMoodFromPath,
  peekMoodDetailScrollRestore,
  peekMoodDetailTabScrollSnapshots,
  stashMoodDetailReturnFilters,
  stashMoodDetailTabScrollSnapshots,
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
  albumScrollSnapshotRef?: RefObject<AlbumBrowseScrollSnapshot>,
  trackScrollSnapshotRef?: RefObject<AlbumBrowseScrollSnapshot>,
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

  const restoreTabScrollSnapshots = useMemo(
    () =>
      peekMoodDetailTabScrollSnapshots(
        serverId,
        moodName,
      ),
    [serverId, moodName],
  );

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
    clearMoodDetailTabScrollSnapshots(
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
    const snapshot = scrollSnapshotRef?.current;
    const albumSnapshot =
      albumScrollSnapshotRef?.current;
    const trackSnapshot =
      trackScrollSnapshotRef?.current;

    return () => {
      if (!serverId || !moodName) return;

      const path =
        window.location.pathname;

      if (
        isAlbumDetailPath(path) ||
        isArtistDetailPath(path)
      ) {
        const scrollTop = Math.max(
          readInpageScrollTop(
            MOOD_DETAIL_INPAGE_SCROLL_VIEWPORT_ID,
          ),
          snapshot?.scrollTop ?? 0,
        );

        const activeView =
          new URLSearchParams(
            location.search,
          ).get('view') === 'tracks'
            ? 'tracks'
            : 'albums';
        const activeDisplayCount =
          snapshot?.displayCount ?? 0;

        stashMoodDetailTabScrollSnapshots(
          serverId,
          moodName,
          {
            albums: {
              scrollTop:
                activeView === 'albums'
                  ? scrollTop
                  : albumSnapshot?.scrollTop ?? 0,
              displayCount:
                activeView === 'albums'
                  ? activeDisplayCount
                  : albumSnapshot?.displayCount ?? 0,
            },
            tracks: {
              scrollTop:
                activeView === 'tracks'
                  ? scrollTop
                  : trackSnapshot?.scrollTop ?? 0,
              displayCount:
                activeView === 'tracks'
                  ? activeDisplayCount
                  : trackSnapshot?.displayCount ?? 0,
            },
          },
        );

        stashMoodDetailReturnFilters(
          serverId,
          moodName,
          {
            ...DEFAULT_ALBUM_BROWSE_RETURN_FILTERS,
            scrollTop,
            displayCount:
              activeDisplayCount,
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
        clearMoodDetailTabScrollSnapshots(
          serverId,
          moodName,
        );
      }
    };
  }, [
    serverId,
    moodName,
    location.search,
    scrollSnapshotRef,
    albumScrollSnapshotRef,
    trackScrollSnapshotRef,
  ]);

  return {
    sort,
    restoreDisplayCount:
      restoreSnapshot.displayCount,
    // The saved count belongs to whichever tab was visible when detail navigation began.
    restoreView: restoreSnapshot.view,
    restoreTabScrollSnapshots,
  };
}