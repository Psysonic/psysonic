import {
  useEffect,
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
  const restoreKeyRef = useRef('');
  const restoreDisplayCountRef =
    useRef<number | undefined>(undefined);

  const restoreKey =
    `${serverId}:${moodName}`;

  // React Compiler refs rule: ref read imperatively outside reactive rendering; not used to compute the render output.
  // eslint-disable-next-line react-hooks/refs
  if (restoreKeyRef.current !== restoreKey) {
    // React Compiler refs rule: ref kept in sync with the latest value for use in effects/handlers/cleanup; not render data.
    // eslint-disable-next-line react-hooks/refs
    restoreKeyRef.current = restoreKey;

    // React Compiler refs rule: ref kept in sync with the latest value for use in effects/handlers/cleanup; not render data.
    // eslint-disable-next-line react-hooks/refs
    restoreDisplayCountRef.current =
      peekMoodDetailScrollRestore(
        serverId,
        moodName,
      )?.displayCount;
  }

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

      if (isAlbumDetailPath(path)) {
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
    // React Compiler refs rule: ref read imperatively outside reactive rendering; not used to compute the render output.
    // eslint-disable-next-line react-hooks/refs
    restoreDisplayCount: restoreDisplayCountRef.current,
  };
}