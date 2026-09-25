import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';
import { useClientSliceInfiniteScroll } from '@/lib/hooks/useClientSliceInfiniteScroll';
import { useInpageScrollSentinel } from '@/lib/hooks/useInpageScrollSentinel';
import type { AlbumBrowseSort } from '@/lib/library/albumBrowseSort';
import type { LibraryBrowseScope } from '@/lib/library/libraryBrowseScope';
import {
  fetchMoodAlbumPage,
  MOOD_ALBUM_CATALOG_CHUNK,
  MOOD_ALBUM_FIRST_PAGE,
} from '@/lib/library/moodAlbumBrowse';
import { dedupeById } from '@/lib/util/dedupeById';

const CLIENT_SLICE_PAGE_SIZE = MOOD_ALBUM_FIRST_PAGE;

function initialSqlPageSize(): number {
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
) {
  const [albums, setAlbums] = useState<SubsonicAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [catalogHasMore, setCatalogHasMore] = useState(false);

  const catalogOffsetRef = useRef(0);
  const catalogLoadingRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const loadingRef = useRef(false);
  const loadPendingRef = useRef(false);
  const loadMoreRef = useRef<() => void>(() => {});

  const {
    visibleCount,
    loadingMore: sliceLoadingMore,
    loadMore: sliceLoadMore,
  } = useClientSliceInfiniteScroll({
    pageSize: CLIENT_SLICE_PAGE_SIZE,
    resetDeps: [
      sort,
      mood,
      musicLibraryFilterVersion,
      browseScope.fingerprint,
      serverId,
      indexEnabled,
    ],
    getScrollRoot,
    scrollRootEl,
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
      return;
    }

    let cancelled = false;

    loadGenerationRef.current += 1;

    const generation = loadGenerationRef.current;

    catalogOffsetRef.current = 0;
    catalogLoadingRef.current = false;
    loadingRef.current = true;
    loadPendingRef.current = true;

    setLoading(true);
    setCatalogLoadingMore(false);
    setCatalogHasMore(false);
    setAlbums([]);

    const firstPageSize = initialSqlPageSize();

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
    });

    return () => {
      cancelled = true;
    };
  }, [
    serverId,
    mood,
    indexEnabled,
    sort,
    musicLibraryFilterVersion,
    browseScope.fingerprint,
    loadCatalogChunk,
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
    loadingMore,
    hasMore,
    loadMore,
    bindLoadMoreSentinel,
  };
}