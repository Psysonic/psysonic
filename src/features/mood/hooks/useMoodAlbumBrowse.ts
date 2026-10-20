import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';
import { useClientSliceInfiniteScroll } from '@/lib/hooks/useClientSliceInfiniteScroll';
import { useInpageScrollSentinel } from '@/lib/hooks/useInpageScrollSentinel';
import type { AlbumBrowseSort } from '@/lib/library/albumBrowseSort';
import type { LibraryBrowseScope } from '@/lib/library/libraryBrowseScope';
import { useLibraryScopeSyncRevision } from '@/store/offlineLocalLibrarySyncRevision';
import {
  fetchMoodAlbumPage,
  MOOD_ALBUM_CATALOG_CHUNK,
  MOOD_ALBUM_FIRST_PAGE,
} from '@/lib/library/moodAlbumBrowse';
import { dedupeById } from '@/lib/util/dedupeById';

const CLIENT_SLICE_PAGE_SIZE = MOOD_ALBUM_FIRST_PAGE;
const MOOD_ALBUM_BROWSE_CACHE_MAX = 2;

type MoodAlbumBrowseCacheEntry = {
  albums: SubsonicAlbum[];
  catalogHasMore: boolean;
  displayCount: number;
};

const moodAlbumBrowseCache =
  new Map<string, MoodAlbumBrowseCacheEntry>();

function peekMoodAlbumBrowseCache(
  key: string,
): MoodAlbumBrowseCacheEntry | null {
  return moodAlbumBrowseCache.get(key) ?? null;
}

function readMoodAlbumBrowseCache(
  key: string,
): MoodAlbumBrowseCacheEntry | null {
  const cached = moodAlbumBrowseCache.get(key);
  if (!cached) return null;

  moodAlbumBrowseCache.delete(key);
  moodAlbumBrowseCache.set(key, cached);
  return cached;
}

function writeMoodAlbumBrowseCache(
  key: string,
  entry: MoodAlbumBrowseCacheEntry,
): void {
  moodAlbumBrowseCache.delete(key);
  moodAlbumBrowseCache.set(key, entry);

  while (moodAlbumBrowseCache.size > MOOD_ALBUM_BROWSE_CACHE_MAX) {
    const oldestKey = moodAlbumBrowseCache.keys().next().value;
    if (oldestKey == null) break;
    moodAlbumBrowseCache.delete(oldestKey);
  }
}

function initialSqlPageSize(
  restoreDisplayCount?: number,
): number {
  if (
    restoreDisplayCount != null &&
    restoreDisplayCount >
      CLIENT_SLICE_PAGE_SIZE
  ) {
    return Math.min(
      restoreDisplayCount,
      MOOD_ALBUM_CATALOG_CHUNK,
    );
  }

  return CLIENT_SLICE_PAGE_SIZE;
}

export function useMoodAlbumBrowse(
  serverId: string,
  mood: string,
  indexEnabled: boolean,
  sort: AlbumBrowseSort,
  musicLibraryFilterVersion: number,
  browseScope: LibraryBrowseScope,
  getScrollRoot?: () => HTMLElement | null,
  scrollRootEl?: HTMLElement | null,
  restoreDisplayCount?: number,
) {
  const syncServerIds =
    browseScope.serverIds.length > 0
      ? browseScope.serverIds
      : serverId
        ? [serverId]
        : [];
  const librarySyncRevision =
    useLibraryScopeSyncRevision(syncServerIds);
  const cacheKey = JSON.stringify([
    serverId,
    mood.trim().toLowerCase(),
    indexEnabled,
    sort,
    musicLibraryFilterVersion,
    librarySyncRevision,
    browseScope.fingerprint,
  ]);
  const cachedForKey =
    mood ? peekMoodAlbumBrowseCache(cacheKey) : null;

  const [albums, setAlbums] = useState<SubsonicAlbum[]>(
    () => cachedForKey?.albums ?? [],
  );
  const [loading, setLoading] = useState(
    () => !!mood && !cachedForKey,
  );
  const [sessionReady, setSessionReady] = useState(
    () => !!mood && cachedForKey !== null,
  );
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [catalogHasMore, setCatalogHasMore] = useState(
    () => cachedForKey?.catalogHasMore ?? false,
  );

  const catalogOffsetRef = useRef(
    cachedForKey?.albums.length ?? 0,
  );
  const catalogLoadingRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const loadingRef = useRef(false);
  const loadPendingRef = useRef(false);
  const loadMoreRef = useRef<() => void>(() => {});

  const browseSessionRef = useRef({
    key: '',
    restoreDisplayCount: undefined as number | undefined,
  });
  const browseKey = cacheKey;

  // React Compiler refs rule: ref read imperatively outside reactive rendering; not used to compute the render output.
  // eslint-disable-next-line react-hooks/refs
  if (browseSessionRef.current.key !== browseKey) {
    // React Compiler refs rule: ref kept in sync with the latest value for use in effects/handlers/cleanup; not render data.
    // eslint-disable-next-line react-hooks/refs
    browseSessionRef.current = {
      key: browseKey,
      restoreDisplayCount:
        cachedForKey?.displayCount ??
        restoreDisplayCount,
    };
  }

  const sessionRestoreDisplayCount =
    browseSessionRef.current.restoreDisplayCount;

  const {
    visibleCount,
    loadingMore: sliceLoadingMore,
    loadMore: sliceLoadMore,
  // React Compiler refs rule: ref read imperatively outside reactive rendering; not used to compute the render output.
  // eslint-disable-next-line react-hooks/refs
  } = useClientSliceInfiniteScroll({
    pageSize: CLIENT_SLICE_PAGE_SIZE,
    resetDeps: [
      sort,
      mood,
      musicLibraryFilterVersion,
      librarySyncRevision,
      browseScope.fingerprint,
      serverId,
      indexEnabled,
    ],
    getScrollRoot,
    scrollRootEl,
    // React Compiler refs rule: ref read imperatively outside reactive rendering; not used to compute the render output.
    // eslint-disable-next-line react-hooks/refs
    restoreDisplayCount: sessionRestoreDisplayCount,
  });

  const displayAlbums = useMemo(
    () => albums.slice(0, visibleCount),
    [albums, visibleCount],
  );

  const hasMore = visibleCount < albums.length || catalogHasMore;
  const loadingMore = sliceLoadingMore || catalogLoadingMore;

  const loadCatalogChunk = useCallback(
    async (
      offset: number,
      append: boolean,
      pageSize: number = MOOD_ALBUM_CATALOG_CHUNK,
    ) => {
      if (catalogLoadingRef.current || !mood) return;

      const generation = loadGenerationRef.current;

      catalogLoadingRef.current = true;
      setCatalogLoadingMore(true);

      try {
        const chunk = await fetchMoodAlbumPage(
          serverId,
          mood,
          indexEnabled,
          offset,
          pageSize,
          sort,
          browseScope,
        );

        if (generation !== loadGenerationRef.current) return;

        if (append) {
          setAlbums(previous => {
            const merged = dedupeById([
              ...previous,
              ...chunk.albums,
            ]);

            catalogOffsetRef.current = merged.length;

            return merged;
          });
        } else {
          setAlbums(chunk.albums);
          catalogOffsetRef.current = chunk.albums.length;
        }

        setCatalogHasMore(chunk.hasMore);
      } finally {
        catalogLoadingRef.current = false;

        if (generation === loadGenerationRef.current) {
          setCatalogLoadingMore(false);
        }
      }
    },
    [
      serverId,
      mood,
      indexEnabled,
      sort,
      browseScope,
    ],
  );

  useEffect(() => {
    if (!mood) {
      // React Compiler set-state-in-effect rule: state reset for an empty route key.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAlbums([]);
      setCatalogHasMore(false);
      setLoading(false);
      setSessionReady(false);
      return;
    }

    let cancelled = false;

    loadGenerationRef.current += 1;

    const generation = loadGenerationRef.current;
    const cached = readMoodAlbumBrowseCache(cacheKey);

    if (cached) {
      catalogOffsetRef.current = cached.albums.length;
      catalogLoadingRef.current = false;
      loadingRef.current = false;
      loadPendingRef.current = false;
      setAlbums(cached.albums);
      setCatalogHasMore(cached.catalogHasMore);
      setCatalogLoadingMore(false);
      setLoading(false);
      setSessionReady(true);

      return () => {
        cancelled = true;
      };
    }

    catalogOffsetRef.current = 0;
    catalogLoadingRef.current = false;
    loadingRef.current = true;
    loadPendingRef.current = true;

    setLoading(true);
    setSessionReady(false);
    setCatalogLoadingMore(false);
    setCatalogHasMore(false);
    setAlbums([]);

    const firstPageSize =
      initialSqlPageSize(
        sessionRestoreDisplayCount,
      );

    void loadCatalogChunk(
      0,
      false,
      firstPageSize,
    ).finally(() => {
      if (
        cancelled ||
        generation !== loadGenerationRef.current
      ) {
        return;
      }

      loadingRef.current = false;
      loadPendingRef.current = false;
      setLoading(false);
      setSessionReady(true);
    });

    return () => {
      cancelled = true;
    };
  },
  // sessionRestoreDisplayCount is read once to
  // restore the prior visible count; the catalog
  // load must not re-run when it later changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [
    serverId,
    mood,
    indexEnabled,
    sort,
    musicLibraryFilterVersion,
    browseScope.fingerprint,
    cacheKey,
    loadCatalogChunk,
  ]);

  useEffect(() => {
    if (!mood || !sessionReady) return;

    writeMoodAlbumBrowseCache(
      cacheKey,
      {
        albums,
        catalogHasMore,
        displayCount: displayAlbums.length,
      },
    );
  }, [
    mood,
    sessionReady,
    cacheKey,
    albums,
    catalogHasMore,
    displayAlbums.length,
  ]);

  const loadMore = useCallback(() => {
    if (
      !mood ||
      loadingRef.current ||
      loadPendingRef.current
    ) {
      return;
    }

    if (visibleCount < albums.length) {
      sliceLoadMore();
      return;
    }

    if (
      catalogHasMore &&
      !catalogLoadingRef.current
    ) {
      void loadCatalogChunk(
        catalogOffsetRef.current,
        true,
      );
    }
  }, [
    mood,
    visibleCount,
    albums.length,
    catalogHasMore,
    sliceLoadMore,
    loadCatalogChunk,
  ]);

  // React Compiler refs rule: ref kept current for the sentinel callback.
  // eslint-disable-next-line react-hooks/refs
  loadMoreRef.current = loadMore;

  const sentinelIntersectingRef = useRef(false);
  const paginationProgressRef = useRef('');

  const bindLoadMoreSentinel =
    useInpageScrollSentinel({
      active: hasMore,
      getScrollRoot,
      scrollRootEl,
      onIntersect: () =>
        loadMoreRef.current(),
      intersectingRef:
        sentinelIntersectingRef,
    });

  useEffect(() => {
    const progress =
      `${albums.length}:${displayAlbums.length}`;

    if (
      paginationProgressRef.current ===
      progress
    ) {
      return;
    }

    paginationProgressRef.current =
      progress;

    if (
      !hasMore ||
      !sentinelIntersectingRef.current
    ) {
      return;
    }

    loadMoreRef.current();
  }, [
    albums.length,
    displayAlbums.length,
    hasMore,
  ]);

  return {
    albums,
    displayAlbums,
    loading,
    sessionReady,
    loadingMore,
    hasMore,
    loadMore,
    bindLoadMoreSentinel,
  };
}