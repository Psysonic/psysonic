import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ArrowLeft } from 'lucide-react';
import {
  useLocation,
  useNavigate,
  useParams,
} from 'react-router';
import { useTranslation } from 'react-i18next';

import {
  AlbumCard,
  useAlbumBrowseScrollRestore,
  useAlbumBrowseScrollSnapshotSync,
  type AlbumBrowseScrollSnapshot,
} from '@/features/album';
import { PagedSongList } from '@/features/search';
import { MOOD_DETAIL_INPAGE_SCROLL_VIEWPORT_ID } from '@/constants/appScroll';
import { albumGridWarmCovers } from '@/cover/layoutSizes';
import { useInpageScrollSentinel } from '@/lib/hooks/useInpageScrollSentinel';
import { useInpageScrollViewport } from '@/lib/hooks/useInpageScrollViewport';
import { useMainstageInpageHeaderTight } from '@/lib/hooks/useMainstageInpageHeaderTight';
import { deriveLibraryBrowseScope } from '@/lib/library/libraryBrowseScope';
import { fetchMoodAlbumTotal } from '@/lib/library/moodAlbumBrowse';
import { usePerfProbeFlags } from '@/lib/perf/perfFlags';
import { useUnavailableServerIds } from '@/lib/network/serverReachability';
import { useAuthStore } from '@/store/authStore';
import { useLibraryIndexStore } from '@/store/libraryIndexStore';
import InpageScrollSentinel from '@/ui/InpageScrollSentinel';
import OverlayScrollArea from '@/ui/OverlayScrollArea';
import { VirtualCardGrid } from '@/ui/VirtualCardGrid';
import { readAlbumBrowseRestore } from '@/lib/navigation/albumDetailNavigation';
import { useMoodAlbumBrowse } from '../hooks/useMoodAlbumBrowse';
import { useMoodDetailBrowse } from '../hooks/useMoodDetailBrowse';
import { useMoodTrackBrowse } from '../hooks/useMoodTrackBrowse';

type MoodDetailView = 'albums' | 'tracks';

function moodDetailView(search: string): MoodDetailView {
  return new URLSearchParams(search).get('view') === 'tracks'
    ? 'tracks'
    : 'albums';
}

export default function MoodDetail() {
  const { name } = useParams<{ name: string }>();
  const mood = name ?? '';

  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const perfFlags = usePerfProbeFlags();
  const view = moodDetailView(location.search);

  const musicLibraryFilterVersion = useAuthStore(
    state => state.musicLibraryFilterVersion,
  );
  const activeServerId = useAuthStore(
    state => state.activeServerId ?? '',
  );
  const servers = useAuthStore(state => state.servers);
  const libraryBrowseServerIds = useAuthStore(
    state => state.libraryBrowseServerIds,
  );
  const musicFoldersByServer = useAuthStore(
    state => state.musicFoldersByServer,
  );
  const libraryBrowseSelectionByServer = useAuthStore(
    state => state.libraryBrowseSelectionByServer,
  );
  const unavailableServerIds = useUnavailableServerIds();

  const browseScope = useMemo(
    () =>
      deriveLibraryBrowseScope(
        {
          servers,
          activeServerId: activeServerId || null,
          libraryBrowseServerIds,
          musicFoldersByServer,
          libraryBrowseSelectionByServer,
        },
        unavailableServerIds,
      ),
    [
      activeServerId,
      libraryBrowseSelectionByServer,
      libraryBrowseServerIds,
      musicFoldersByServer,
      servers,
      unavailableServerIds,
    ],
  );

  const serverId = browseScope.anchorServerId ?? activeServerId;
  const indexEnabled = useLibraryIndexStore(
    state => state.isIndexEnabled(serverId),
  );

  const scrollSnapshotRef = useRef<AlbumBrowseScrollSnapshot>({
    scrollTop: 0,
    displayCount: 0,
  });

  const {
    sort,
    restoreDisplayCount,
    restoreView,
  } = useMoodDetailBrowse(
    serverId,
    mood,
    scrollSnapshotRef,
  );

  const {
    scrollBodyEl,
    bindScrollBody,
    getScrollRoot,
  } = useInpageScrollViewport();

  const albumMood = view === 'albums' ? mood : '';
  const {
    albums,
    loading: albumsLoading,
    loadingMore: albumsLoadingMore,
    hasMore: albumsHasMore,
    displayAlbums,
    bindLoadMoreSentinel,
    loadMore: loadMoreAlbums,
  } = useMoodAlbumBrowse(
    serverId,
    albumMood,
    indexEnabled,
    sort,
    musicLibraryFilterVersion,
    browseScope,
    getScrollRoot,
    scrollBodyEl,
    restoreView === 'albums'
      ? restoreDisplayCount
      : undefined,
  );

  const {
    songs,
    total: trackCount,
    loading: tracksLoading,
    loadingMore: tracksLoadingMore,
    hasMore: tracksHasMore,
    loadMore: loadMoreTracks,
  } = useMoodTrackBrowse(
    serverId,
    mood,
    indexEnabled,
    view === 'tracks',
    musicLibraryFilterVersion,
    browseScope,
  );

  const bindTrackLoadMoreSentinel = useInpageScrollSentinel({
    active: view === 'tracks' && tracksHasMore,
    getScrollRoot,
    scrollRootEl: scrollBodyEl,
    onIntersect: loadMoreTracks,
    rootMargin: '600px',
  });

  const activeDisplayCount =
    view === 'albums'
      ? displayAlbums.length
      : songs.length;
  const activeLoading =
    view === 'albums'
      ? albumsLoading
      : tracksLoading;
  const activeLoadingMore =
    view === 'albums'
      ? albumsLoadingMore
      : tracksLoadingMore;
  const activeHasMore =
    view === 'albums'
      ? albumsHasMore
      : tracksHasMore;
  const activeLoadMore =
    view === 'albums'
      ? loadMoreAlbums
      : loadMoreTracks;

  useAlbumBrowseScrollSnapshotSync(
    scrollSnapshotRef,
    scrollBodyEl,
    activeDisplayCount,
  );

  const { isScrollRestorePending } = useAlbumBrowseScrollRestore({
    serverId,
    moodName: mood,
    scrollBodyEl,
    // The restore hook is item-count agnostic; Mood Tracks reuses the same
    // session contract as the album grid.
    displayAlbumsLength: activeDisplayCount,
    loading: activeLoading,
    loadingMore: activeLoadingMore,
    hasMore: activeHasMore,
    loadMore: activeLoadMore,
  });

  useEffect(() => {
    if (
      isScrollRestorePending ||
      !readAlbumBrowseRestore(location.state)
    ) {
      return;
    }

    navigate(
      `${location.pathname}${location.search}${location.hash}`,
      { replace: true, state: null },
    );
  }, [
    view,
    isScrollRestorePending,
    location.pathname,
    location.search,
    location.hash,
    location.state,
    navigate,
  ]);

  const [albumCount, setAlbumCount] = useState<number | null>(null);

  useEffect(() => {
    if (!mood || !serverId || !indexEnabled) return;

    let cancelled = false;

    // Album count belongs to the current mood/scope route. Track count is
    // returned with the first Tracks page so Albums does no track-count work.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAlbumCount(null);

    const timer = window.setTimeout(() => {
      void fetchMoodAlbumTotal(
        serverId,
        mood,
        indexEnabled,
        sort,
        browseScope,
      ).then(albumsTotal => {
        if (cancelled) return;
        setAlbumCount(albumsTotal);
      });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    serverId,
    mood,
    indexEnabled,
    sort,
    browseScope,
    musicLibraryFilterVersion,
  ]);

  const resolvedAlbumCount =
    albumCount ??
    (!albumsLoading && !albumsHasMore && view === 'albums'
      ? albums.length
      : null);
  const resolvedTrackCount =
    trackCount ??
    (!tracksLoading && !tracksHasMore && view === 'tracks'
      ? songs.length
      : null);

  const handleBack = useCallback(() => {
    const state =
      location.state as { returnTo?: string } | null;
    navigate(state?.returnTo ?? '/moods');
  }, [location.state, navigate]);

  const selectView = useCallback(
    (next: MoodDetailView) => {
      const params = new URLSearchParams(location.search);
      if (next === 'tracks') {
        params.set('view', 'tracks');
      } else {
        params.delete('view');
      }

      const search = params.toString();
      navigate(
        {
          pathname: location.pathname,
          search: search ? `?${search}` : '',
          hash: location.hash,
        },
        {
          replace: true,
          state: location.state,
        },
      );
    },
    [
      location.pathname,
      location.search,
      location.hash,
      location.state,
      navigate,
    ],
  );

  const onTabsKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const next = view === 'albums' ? 'tracks' : 'albums';
      selectView(next);
      window.setTimeout(() => {
        document.getElementById(`mood-detail-tab-${next}`)?.focus();
      }, 0);
    },
    [selectView, view],
  );

  const mainstageHeaderTight = useMainstageInpageHeaderTight(
    scrollBodyEl,
    [mood, resolvedAlbumCount, resolvedTrackCount, view],
  );

  const activeCount = activeDisplayCount;

  return (
    <div
      className={
        `content-body animate-fade-in mainstage-inpage-split${mainstageHeaderTight
          ? ' mainstage-inpage--header-tight'
          : ''}`
      }
    >
      <div className="mainstage-inpage-toolbar">
        <div className="page-sticky-header mainstage-inpage-toolbar-row">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleBack}
            aria-label={t('moods.back')}
            data-tooltip={t('moods.back')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginRight: '0.25rem',
            }}
          >
            <ArrowLeft size={16} />
            <span className="toolbar-btn-label">
              {t('moods.back')}
            </span>
          </button>

          <div className="psy-page-heading psy-page-heading--fill">
            <h1 className="page-title truncate" title={mood}>
              {mood}
            </h1>

            {(resolvedAlbumCount != null || resolvedTrackCount != null) && (
              <span className="psy-page-heading__count">
                <span aria-hidden="true">–</span>
                {resolvedAlbumCount != null &&
                  t('moods.albumCount', { count: resolvedAlbumCount })}
                {resolvedAlbumCount != null && resolvedTrackCount != null && (
                  <span aria-hidden="true"> • </span>
                )}
                {resolvedTrackCount != null &&
                  t('tracks.count', { count: resolvedTrackCount })}
              </span>
            )}
          </div>

          <div
            className="artist-tracks-tabs"
            role="tablist"
            aria-label={t('moods.viewTabsLabel')}
            onKeyDown={onTabsKeyDown}
          >
            <button
              type="button"
              role="tab"
              id="mood-detail-tab-albums"
              aria-selected={view === 'albums'}
              aria-controls="mood-detail-panel"
              tabIndex={view === 'albums' ? 0 : -1}
              className={`btn ${view === 'albums' ? 'btn-primary' : 'btn-ghost'} artist-tracks-tab`}
              onClick={() => selectView('albums')}
            >
              {t('moods.albumsTab')}
            </button>
            <button
              type="button"
              role="tab"
              id="mood-detail-tab-tracks"
              aria-selected={view === 'tracks'}
              aria-controls="mood-detail-panel"
              tabIndex={view === 'tracks' ? 0 : -1}
              className={`btn ${view === 'tracks' ? 'btn-primary' : 'btn-ghost'} artist-tracks-tab`}
              onClick={() => selectView('tracks')}
            >
              {t('moods.tracksTab')}
            </button>
          </div>
        </div>
      </div>

      <OverlayScrollArea
        className="mainstage-inpage-scroll"
        viewportClassName="mainstage-inpage-scroll__viewport"
        viewportId={MOOD_DETAIL_INPAGE_SCROLL_VIEWPORT_ID}
        viewportRef={bindScrollBody}
        railInset="panel"
        measureDeps={[
          activeLoading,
          activeCount,
          activeHasMore,
          mood,
          view,
          perfFlags.disableMainstageVirtualLists,
        ]}
      >
        <div
          id="mood-detail-panel"
          role="tabpanel"
          aria-labelledby={`mood-detail-tab-${view}`}
        >
          {view === 'albums' ? (
            albumsLoading && albums.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  padding: '3rem',
                }}
              >
                <div className="spinner" />
              </div>
            ) : !albumsLoading && displayAlbums.length === 0 ? (
              <p
                className="loading-text"
                style={{
                  padding: '3rem 1rem',
                  textAlign: 'center',
                }}
              >
                {t('moods.albumsEmpty')}
              </p>
            ) : (
              <div style={{ position: 'relative' }}>
                <div
                  style={{
                    visibility: isScrollRestorePending ? 'hidden' : 'visible',
                  }}
                >
                  <VirtualCardGrid
                    items={displayAlbums}
                    itemKey={album => album.id}
                    rowVariant="album"
                    disableVirtualization={perfFlags.disableMainstageVirtualLists}
                    layoutSignal={displayAlbums.length}
                    scrollRootId={MOOD_DETAIL_INPAGE_SCROLL_VIEWPORT_ID}
                    warmGridCovers={albumGridWarmCovers()}
                    renderItem={album => (
                      <AlbumCard
                        album={album}
                        observeScrollRootId={
                          MOOD_DETAIL_INPAGE_SCROLL_VIEWPORT_ID
                        }
                      />
                    )}
                  />

                  {albumsHasMore && (
                    <InpageScrollSentinel
                      bindSentinel={bindLoadMoreSentinel}
                      loading={albumsLoadingMore}
                      itemCount={displayAlbums.length}
                    />
                  )}
                </div>

                {isScrollRestorePending && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      justifyContent: 'center',
                      paddingTop: '3rem',
                      background: 'var(--bg-app)',
                    }}
                  >
                    <div className="spinner" />
                  </div>
                )}
              </div>
            )
          ) : tracksLoading && songs.length === 0 ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                padding: '3rem',
              }}
            >
              <div className="spinner" />
            </div>
          ) : !tracksLoading && songs.length === 0 ? (
            <p
              className="loading-text"
              style={{
                padding: '3rem 1rem',
                textAlign: 'center',
              }}
            >
              {t('moods.tracksEmpty')}
            </p>
          ) : (
            <div style={{ position: 'relative' }}>
              <div
                style={{
                  visibility: isScrollRestorePending ? 'hidden' : 'visible',
                }}
              >
                <PagedSongList
                  songs={songs}
                  hasMore={false}
                  loadingMore={false}
                  onLoadMore={loadMoreTracks}
                />

                {tracksHasMore && (
                  <InpageScrollSentinel
                    bindSentinel={bindTrackLoadMoreSentinel}
                    loading={tracksLoadingMore}
                    itemCount={songs.length}
                    style={{ padding: '1rem', height: 'auto', margin: 0 }}
                  />
                )}
              </div>

              {isScrollRestorePending && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    justifyContent: 'center',
                    paddingTop: '3rem',
                    background: 'var(--bg-app)',
                  }}
                >
                  <div className="spinner" />
                </div>
              )}
            </div>
          )}
        </div>
      </OverlayScrollArea>
    </div>
  );
}
