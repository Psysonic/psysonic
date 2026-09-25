import {
  useCallback,
  useEffect,
  useMemo,
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
  albumBrowseSortForServer,
  useAlbumBrowseSessionStore,
} from '@/features/album';
import {
  MOOD_DETAIL_INPAGE_SCROLL_VIEWPORT_ID,
} from '@/constants/appScroll';
import { albumGridWarmCovers } from '@/cover/layoutSizes';
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

import { useMoodAlbumBrowse } from '../hooks/useMoodAlbumBrowse';

export default function MoodDetail() {
  const { name } =
    useParams<{ name: string }>();

  const mood = decodeURIComponent(
    name ?? '',
  );

  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const perfFlags = usePerfProbeFlags();

  const musicLibraryFilterVersion =
    useAuthStore(
      state =>
        state.musicLibraryFilterVersion,
    );

  const activeServerId =
    useAuthStore(
      state =>
        state.activeServerId ?? '',
    );

  const servers =
    useAuthStore(state => state.servers);

  const libraryBrowseServerIds =
    useAuthStore(
      state =>
        state.libraryBrowseServerIds,
    );

  const musicFoldersByServer =
    useAuthStore(
      state =>
        state.musicFoldersByServer,
    );

  const libraryBrowseSelectionByServer =
    useAuthStore(
      state =>
        state.libraryBrowseSelectionByServer,
    );

  const unavailableServerIds =
    useUnavailableServerIds();

  const browseScope = useMemo(
    () =>
      deriveLibraryBrowseScope(
        {
          servers,
          activeServerId:
            activeServerId || null,
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

  const serverId =
    browseScope.anchorServerId ??
    activeServerId;

  const indexEnabled =
    useLibraryIndexStore(state =>
      state.isIndexEnabled(serverId),
    );

  const sort =
    useAlbumBrowseSessionStore(
      state =>
        albumBrowseSortForServer(
          state.sortByServer,
          serverId,
        ),
    );

  const {
    scrollBodyEl,
    bindScrollBody,
    getScrollRoot,
  } = useInpageScrollViewport();

  const {
    albums,
    loading,
    loadingMore,
    hasMore,
    displayAlbums,
    bindLoadMoreSentinel,
  } = useMoodAlbumBrowse(
    serverId,
    mood,
    indexEnabled,
    sort,
    musicLibraryFilterVersion,
    browseScope,
    getScrollRoot,
    scrollBodyEl,
  );

  const [albumCount, setAlbumCount] =
    useState<number | null>(null);

  useEffect(() => {
    if (
      !mood ||
      !serverId ||
      !indexEnabled
    ) {
      return;
    }

    let cancelled = false;

    // React Compiler set-state-in-effect rule:
    // count belongs to the current mood route.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAlbumCount(null);

    const timer =
      window.setTimeout(() => {
        void fetchMoodAlbumTotal(
          serverId,
          mood,
          indexEnabled,
          sort,
          browseScope,
        ).then(count => {
          if (!cancelled) {
            setAlbumCount(count);
          }
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

  const headerCount =
    albumCount ??
    (
      !loading && !hasMore
        ? albums.length
        : null
    );

  const handleBack =
    useCallback(() => {
      const state =
        location.state as
          | { returnTo?: string }
          | null;

      navigate(
        state?.returnTo ?? '/moods',
      );
    }, [location.state, navigate]);

  const mainstageHeaderTight =
    useMainstageInpageHeaderTight(
      scrollBodyEl,
      [mood, headerCount],
    );

  return (
    <div
      className={
        `content-body animate-fade-in mainstage-inpage-split${
          mainstageHeaderTight
            ? ' mainstage-inpage--header-tight'
            : ''
        }`
      }
    >
      <div className="mainstage-inpage-toolbar">
        <div className="page-sticky-header mainstage-inpage-toolbar-row">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleBack}
            aria-label={t('moods.back', )}
            data-tooltip={t(
              'moods.back',
            )}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginRight: '0.25rem',
            }}
          >
            <ArrowLeft size={16} />

            <span className="toolbar-btn-label">
              {t('moods.back', )}
            </span>
          </button>

          <div className="psy-page-heading psy-page-heading--fill">
            <h1
              className="page-title truncate"
              title={mood}
            >
              {mood}
            </h1>

            {headerCount != null &&
              headerCount > 0 && (
                <span className="psy-page-heading__count">
                  <span aria-hidden="true">
                    –
                  </span>

                  {t(
                    'moods.albumCount',
                    {
                      count:
                        headerCount,
                      },
                  )}
                </span>
              )}
          </div>
        </div>
      </div>

      <OverlayScrollArea
        className="mainstage-inpage-scroll"
        viewportClassName="mainstage-inpage-scroll__viewport"
        viewportId={
          MOOD_DETAIL_INPAGE_SCROLL_VIEWPORT_ID
        }
        viewportRef={bindScrollBody}
        railInset="panel"
        measureDeps={[
          loading,
          displayAlbums.length,
          hasMore,
          mood,
          perfFlags.disableMainstageVirtualLists,
        ]}
      >
        {loading &&
        albums.length === 0 ? (
          <div
            style={{
              display: 'flex',
              justifyContent:
                'center',
              padding: '3rem',
            }}
          >
            <div className="spinner" />
          </div>
        ) : !loading &&
          displayAlbums.length === 0 ? (
          <p
            className="loading-text"
            style={{
              padding: '3rem 1rem',
              textAlign: 'center',
            }}
          >
            {t('moods.albumsEmpty', )}
          </p>
        ) : (
          <div
            style={{
              position: 'relative',
            }}
          >
            <VirtualCardGrid
              items={displayAlbums}
              itemKey={(album, _index) =>
                album.id
              }
              rowVariant="album"
              disableVirtualization={
                perfFlags.disableMainstageVirtualLists
              }
              layoutSignal={
                displayAlbums.length
              }
              scrollRootId={
                MOOD_DETAIL_INPAGE_SCROLL_VIEWPORT_ID
              }
              warmGridCovers={
                albumGridWarmCovers()
              }
              renderItem={album => (
                <AlbumCard
                  album={album}
                  observeScrollRootId={
                    MOOD_DETAIL_INPAGE_SCROLL_VIEWPORT_ID
                  }
                />
              )}
            />

            {hasMore && (
              <InpageScrollSentinel
                bindSentinel={
                  bindLoadMoreSentinel
                }
                loading={loadingMore}
                itemCount={
                  displayAlbums.length
                }
              />
            )}
          </div>
        )}
      </OverlayScrollArea>
    </div>
  );
}