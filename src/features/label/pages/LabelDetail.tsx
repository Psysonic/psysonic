import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import {
  AlbumCard,
  useAlbumBrowseScrollRestore,
  useAlbumBrowseScrollSnapshotSync,
  type AlbumBrowseScrollSnapshot,
} from '@/features/album';
import { LABEL_DETAIL_INPAGE_SCROLL_VIEWPORT_ID } from '@/constants/appScroll';
import { albumGridWarmCovers } from '@/cover/layoutSizes';
import { useInpageScrollViewport } from '@/lib/hooks/useInpageScrollViewport';
import { useMainstageInpageHeaderTight } from '@/lib/hooks/useMainstageInpageHeaderTight';
import { fetchLabelAlbumTotal } from '@/lib/library/labelAlbumBrowse';
import { deriveLibraryBrowseScope } from '@/lib/library/libraryBrowseScope';
import { readAlbumBrowseRestore, readAlbumDetailReturnTo } from '@/lib/navigation/albumDetailNavigation';
import { useUnavailableServerIds } from '@/lib/network/serverReachability';
import { usePerfProbeFlags } from '@/lib/perf/perfFlags';
import { useAuthStore } from '@/store/authStore';
import { useLibraryIndexStore } from '@/store/libraryIndexStore';
import InpageScrollSentinel from '@/ui/InpageScrollSentinel';
import OverlayScrollArea from '@/ui/OverlayScrollArea';
import { VirtualCardGrid } from '@/ui/VirtualCardGrid';
import { useLabelAlbumBrowse } from '../hooks/useLabelAlbumBrowse';
import { useLabelDetailBrowse } from '../hooks/useLabelDetailBrowse';

export default function LabelDetail() {
  const { name } = useParams<{ name: string }>();
  const label = name ?? '';
  const { t } = useTranslation();
  const perfFlags = usePerfProbeFlags();
  const navigate = useNavigate();
  const location = useLocation();
  const musicLibraryFilterVersion = useAuthStore(s => s.musicLibraryFilterVersion);
  const activeServerId = useAuthStore(s => s.activeServerId ?? '');
  const servers = useAuthStore(s => s.servers);
  const libraryBrowseServerIds = useAuthStore(s => s.libraryBrowseServerIds);
  const musicFoldersByServer = useAuthStore(s => s.musicFoldersByServer);
  const libraryBrowseSelectionByServer = useAuthStore(s => s.libraryBrowseSelectionByServer);
  const unavailableServerIds = useUnavailableServerIds();
  const browseScope = useMemo(
    () => deriveLibraryBrowseScope({
      servers,
      activeServerId: activeServerId || null,
      libraryBrowseServerIds,
      musicFoldersByServer,
      libraryBrowseSelectionByServer,
    }, unavailableServerIds),
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
  const indexEnabled = useLibraryIndexStore(s => s.isIndexEnabled(serverId));

  const scrollSnapshotRef = useRef<AlbumBrowseScrollSnapshot>({ scrollTop: 0, displayCount: 0 });
  const { sort, restoreDisplayCount } = useLabelDetailBrowse(serverId, label, scrollSnapshotRef);
  const { scrollBodyEl, bindScrollBody, getScrollRoot } = useInpageScrollViewport();

  const {
    albums,
    loading,
    loadingMore,
    hasMore,
    displayAlbums,
    bindLoadMoreSentinel,
    loadMore,
  } = useLabelAlbumBrowse(
    serverId,
    label,
    indexEnabled,
    sort,
    musicLibraryFilterVersion,
    browseScope,
    getScrollRoot,
    scrollBodyEl,
    restoreDisplayCount,
  );

  useAlbumBrowseScrollSnapshotSync(scrollSnapshotRef, scrollBodyEl, displayAlbums.length);

  const { isScrollRestorePending } = useAlbumBrowseScrollRestore({
    serverId,
    labelName: label,
    scrollBodyEl,
    displayAlbumsLength: displayAlbums.length,
    loading,
    loadingMore,
    hasMore,
    loadMore,
  });

  useEffect(() => {
    if (isScrollRestorePending || !readAlbumBrowseRestore(location.state)) return;
    navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: null });
  }, [isScrollRestorePending, location.pathname, location.search, location.hash, location.state, navigate]);

  const [albumCount, setAlbumCount] = useState<number | null>(null);

  useEffect(() => {
    if (!label || !serverId || loading || !hasMore) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchLabelAlbumTotal(serverId, label, indexEnabled, sort, browseScope).then(count => {
        if (!cancelled) setAlbumCount(count);
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [serverId, label, indexEnabled, sort, musicLibraryFilterVersion, browseScope, loading, hasMore]);

  useEffect(() => {
    // React Compiler set-state-in-effect rule: the total belongs to the current label route.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAlbumCount(null);
  }, [serverId, label, browseScope]);

  const handleBack = useCallback(() => {
    navigate(readAlbumDetailReturnTo(location.state) ?? '/labels');
  }, [navigate, location.state]);

  const mainstageHeaderTight = useMainstageInpageHeaderTight(scrollBodyEl, [label, albumCount]);

  // Every album loaded: count them; otherwise the index total, once known.
  const headerCount = !loading && !hasMore && albums.length > 0 ? albums.length : albumCount;

  return (
    <div className={`content-body animate-fade-in mainstage-inpage-split${mainstageHeaderTight ? ' mainstage-inpage--header-tight' : ''}`}>
      <div className="mainstage-inpage-toolbar">
        <div className="page-sticky-header mainstage-inpage-toolbar-row">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleBack}
            aria-label={t('labels.back')}
            data-tooltip={t('labels.back')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginRight: '0.25rem' }}
          >
            <ArrowLeft size={16} />
            <span className="toolbar-btn-label">{t('labels.back')}</span>
          </button>
          <div className="psy-page-heading psy-page-heading--fill">
            <h1 className="page-title truncate" title={label}>{label}</h1>
            {headerCount != null && headerCount > 0 && (
              <span className="psy-page-heading__count">
                <span aria-hidden="true">–</span>
                {t('labels.albumCount', { count: headerCount })}
              </span>
            )}
          </div>
        </div>
      </div>

      <OverlayScrollArea
        className="mainstage-inpage-scroll"
        viewportClassName="mainstage-inpage-scroll__viewport"
        viewportId={LABEL_DETAIL_INPAGE_SCROLL_VIEWPORT_ID}
        viewportRef={bindScrollBody}
        railInset="panel"
        measureDeps={[
          loading,
          displayAlbums.length,
          hasMore,
          label,
          perfFlags.disableMainstageVirtualLists,
        ]}
      >
        {loading && albums.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
            <div className="spinner" />
          </div>
        ) : !loading && displayAlbums.length === 0 ? (
          <p className="loading-text" style={{ padding: '3rem 1rem', textAlign: 'center' }}>
            {t('labels.albumsEmpty')}
          </p>
        ) : (
          <div style={{ position: 'relative' }}>
            <div style={{ visibility: isScrollRestorePending ? 'hidden' : 'visible' }}>
              <VirtualCardGrid
                items={displayAlbums}
                itemKey={a => `${a.serverId ?? ''}\u0000${a.id}`}
                rowVariant="album"
                disableVirtualization={perfFlags.disableMainstageVirtualLists}
                layoutSignal={displayAlbums.length}
                scrollRootId={LABEL_DETAIL_INPAGE_SCROLL_VIEWPORT_ID}
                warmGridCovers={albumGridWarmCovers()}
                renderItem={album => (
                  <AlbumCard album={album} observeScrollRootId={LABEL_DETAIL_INPAGE_SCROLL_VIEWPORT_ID} />
                )}
              />
              {hasMore && (
                <InpageScrollSentinel
                  bindSentinel={bindLoadMoreSentinel}
                  loading={loadingMore}
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
        )}
      </OverlayScrollArea>
    </div>
  );
}
