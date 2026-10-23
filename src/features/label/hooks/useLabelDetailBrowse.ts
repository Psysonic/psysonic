import { useEffect, useRef, type RefObject } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { LABEL_DETAIL_INPAGE_SCROLL_VIEWPORT_ID, readInpageScrollTop } from '@/constants/appScroll';
import {
  DEFAULT_ALBUM_BROWSE_RETURN_FILTERS,
  albumBrowseSortForServer,
  clearLabelDetailReturnStash,
  labelDetailLabelFromPath,
  isAlbumDetailPath,
  isLabelDetailPath,
  peekLabelDetailScrollRestore,
  stashLabelDetailReturnFilters,
  useAlbumBrowseSessionStore,
} from '@/features/album';
import { shouldRestoreAlbumBrowseSession } from '@/lib/navigation/albumDetailNavigation';
import type { AlbumBrowseScrollSnapshot } from '@/features/album';

/** Label detail: locked label filter + leave/restore session (same contract as genre detail). */
export function useLabelDetailBrowse(
  serverId: string,
  labelName: string,
  scrollSnapshotRef?: RefObject<AlbumBrowseScrollSnapshot>,
) {
  const navigationType = useNavigationType();
  const location = useLocation();
  const sort = useAlbumBrowseSessionStore(s => albumBrowseSortForServer(s.sortByServer, serverId));
  const restoredFromStashRef = useRef(false);
  const restoreKeyRef = useRef('');
  const restoreDisplayCountRef = useRef<number | undefined>(undefined);
  const restoreKey = `${serverId}:${labelName}`;
  // React Compiler refs rule: ref read imperatively outside reactive rendering; not used to compute the render output.
  // eslint-disable-next-line react-hooks/refs
  if (restoreKeyRef.current !== restoreKey) {
    // React Compiler refs rule: ref kept in sync with the latest value for use in effects/handlers/cleanup; not render data.
    // eslint-disable-next-line react-hooks/refs
    restoreKeyRef.current = restoreKey;
    // React Compiler refs rule: ref kept in sync with the latest value for use in effects/handlers/cleanup; not render data.
    // eslint-disable-next-line react-hooks/refs
    restoreDisplayCountRef.current = peekLabelDetailScrollRestore(serverId, labelName)?.displayCount;
  }

  useEffect(() => {
    restoredFromStashRef.current = false;
  }, [serverId, labelName]);

  useEffect(() => {
    if (!serverId || !labelName) return;

    if (shouldRestoreAlbumBrowseSession(navigationType, location.state)) {
      restoredFromStashRef.current = true;
      return;
    }

    if (restoredFromStashRef.current) return;

    clearLabelDetailReturnStash(serverId, labelName);
  }, [serverId, labelName, navigationType, location.state]);

  useEffect(() => {
    return () => {
      if (!serverId || !labelName) return;
      const path = window.location.pathname;
      if (isAlbumDetailPath(path)) {
        // Read at cleanup time on purpose: we want the scroll snapshot as it is
        // at navigation-away. Copying it at effect setup would stash a stale value.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        const snapshot = scrollSnapshotRef?.current;
        const scrollTop = Math.max(
          readInpageScrollTop(LABEL_DETAIL_INPAGE_SCROLL_VIEWPORT_ID),
          snapshot?.scrollTop ?? 0,
        );
        stashLabelDetailReturnFilters(serverId, labelName, {
          ...DEFAULT_ALBUM_BROWSE_RETURN_FILTERS,
          scrollTop,
          displayCount: snapshot?.displayCount,
        });
      } else if (!isLabelDetailPath(path) || labelDetailLabelFromPath(path) !== labelName) {
        clearLabelDetailReturnStash(serverId, labelName);
      }
    };
  }, [serverId, labelName, scrollSnapshotRef]);

  return {
    sort,
    // React Compiler refs rule: ref read imperatively outside reactive rendering; not used to compute the render output.
    // eslint-disable-next-line react-hooks/refs
    restoreDisplayCount: restoreDisplayCountRef.current,
  };
}
