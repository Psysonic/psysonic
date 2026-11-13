import type { SubsonicArtist } from '@/lib/api/subsonicTypes';
import type { ArtistCreditMode } from '@/lib/api/library';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { dedupeById } from '@/lib/util/dedupeById';
import {
  fetchLocalArtistCatalogChunk,
} from '@/lib/library/browseTextSearch';
import {
  fetchNetworkArtistCatalog,
  fetchStarredArtistsForBrowse,
} from '@/features/artist/utils/artistBrowseCreditMode';
import { useOfflineBrowseContext, useOfflineBrowseReloadToken } from '@/features/offline';
import { useOfflineLocalBrowseReloadKey } from '@/store/localPlaybackBrowseRevision';
import { useOfflineLocalLibrarySyncRevision } from '@/store/offlineLocalLibrarySyncRevision';
import {
  fetchOfflineLocalArtistCatalogChunk,
  fetchOfflineLocalStarredArtists,
  offlineLocalBrowseEnabled,
} from '@/features/offline';
import {
  artistBrowseTimed,
  emitArtistsBrowseDebug,
} from '@/lib/library/artistBrowseDebug';
import {
  ARTIST_BROWSE_BOOTSTRAP_CHUNK,
  artistBrowseBootstrapEligible,
  artistBrowseCatalogCacheKey,
  artistBrowseCatalogInflight,
  artistBrowseInitialLoadKey,
  artistBrowseOnlineCatalogKey,
  fetchArtistBrowseCatalogDeduped,
  readArtistBrowseCatalogCache,
  storeArtistBrowseCatalogCache,
} from '@/lib/library/artistBrowseInflight';
import type { LibraryScopePair } from '@/lib/api/library/scopeReads';
import { refreshStarredArtistIndexes } from '@/lib/library/starredArtistIndexSync';
import {
  isSyncOnlyCatalogChange,
  refetchCatalogWindow,
  type BrowseCatalogView,
} from '@/lib/library/browseCatalogSyncRefresh';

/** Local-index artist catalog buffer grows by this many rows per background SQL chunk. */
export const ARTIST_CATALOG_CHUNK_SIZE = 200;

export type ArtistsBrowseMode = 'slice' | 'network';

export type UseArtistsBrowseCatalogArgs = {
  serverId: string | null | undefined;
  indexEnabled: boolean;
  starredOnly: boolean;
  creditMode: ArtistCreditMode;
  letterFilter: string;
  musicLibraryFilterVersion: number;
  libraryScopeKey: string;
  libraryScopes: LibraryScopePair[];
  multiServer: boolean;
  /** Server `ignoredArticles` for offline letter buckets (Navidrome parity). */
  ignoredArticles?: string | null;
};

export function useArtistsBrowseCatalog({
  serverId,
  indexEnabled,
  starredOnly,
  creditMode,
  letterFilter,
  musicLibraryFilterVersion,
  libraryScopeKey,
  libraryScopes,
  multiServer,
  ignoredArticles,
}: UseArtistsBrowseCatalogArgs) {
  const offlineBrowseActive = useOfflineBrowseContext().active;
  const offlineBrowseReloadTs = useOfflineBrowseReloadToken();
  const offlineLocalBrowseReloadKey = useOfflineLocalBrowseReloadKey(
    serverId,
    offlineBrowseActive,
  );
  const librarySyncRevision = useOfflineLocalLibrarySyncRevision(serverId ?? null);
  const [catalogArtists, setCatalogArtists] = useState<SubsonicArtist[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogHasMore, setCatalogHasMore] = useState(false);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [browseMode, setBrowseMode] = useState<ArtistsBrowseMode>('network');

  const loadGenerationRef = useRef(0);
  const catalogOffsetRef = useRef(0);
  const catalogLoadingRef = useRef(false);
  const libraryScopesRef = useRef(libraryScopes);
  useEffect(() => {
    libraryScopesRef.current = libraryScopes;
  }, [libraryScopes, libraryScopeKey]);
  const browseModeRef = useRef(browseMode);
  // React Compiler refs rule: ref kept in sync with the latest value for use in effects/handlers/cleanup; not render data.
  // eslint-disable-next-line react-hooks/refs
  browseModeRef.current = browseMode;
  const catalogArtistsRef = useRef(catalogArtists);
  // React Compiler refs rule: ref kept in sync with the latest value for use in effects/handlers/cleanup; not render data.
  // eslint-disable-next-line react-hooks/refs
  catalogArtistsRef.current = catalogArtists;
  const catalogViewRef = useRef<BrowseCatalogView | null>(null);

  const catalogViewKey = useMemo(() => {
    if (!serverId) return '';
    return artistBrowseInitialLoadKey(
      serverId,
      musicLibraryFilterVersion,
      libraryScopeKey,
      creditMode,
      letterFilter,
      starredOnly,
      offlineBrowseActive,
    );
  }, [serverId, musicLibraryFilterVersion, libraryScopeKey, creditMode, letterFilter, starredOnly, offlineBrowseActive]);

  const catalogLoadKey = useMemo(() => {
    if (!catalogViewKey) return '';
    // Offline browse already re-keys via its own reload key (also sync-driven);
    // online index browse re-keys on the library sync revision so a completed
    // resync surfaces renamed/pruned artists without an app restart.
    if (!offlineBrowseActive) return artistBrowseOnlineCatalogKey(catalogViewKey, librarySyncRevision);
    return `${catalogViewKey}\0${offlineLocalBrowseReloadKey}`;
  }, [catalogViewKey, offlineBrowseActive, offlineLocalBrowseReloadKey, librarySyncRevision]);

  useLayoutEffect(() => {
    const cached = readArtistBrowseCatalogCache(catalogLoadKey);
    if (!cached) return;
    catalogOffsetRef.current = cached.artists.length;
    catalogLoadingRef.current = false;
    // React Compiler set-state-in-effect rule: local state synced from the catalog cache before paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBrowseMode('slice');
    setCatalogArtists(cached.artists);
    setCatalogHasMore(cached.hasMore);
    setCatalogLoadingMore(false);
    setLoading(false);
    emitArtistsBrowseDebug('load_effect_cache_hit', {
      artistCount: cached.artists.length,
      sync: true,
    });
  }, [catalogLoadKey]);

  const loadCatalogChunk = useCallback(async (append: boolean) => {
    if (!serverId || catalogLoadingRef.current) return;
    const generation = loadGenerationRef.current;
    catalogLoadingRef.current = true;
    setCatalogLoadingMore(true);
    emitArtistsBrowseDebug('catalog_chunk_start', { append, offset: catalogOffsetRef.current });
    try {
      if (offlineBrowseActive) {
        if (!offlineLocalBrowseEnabled(serverId)) return;
        const chunk = await artistBrowseTimed(
          'offline_catalog_chunk',
          () => fetchOfflineLocalArtistCatalogChunk(
            serverId,
            catalogOffsetRef.current,
            ARTIST_CATALOG_CHUNK_SIZE,
            creditMode,
            letterFilter,
            ignoredArticles,
          ),
          { append, offset: catalogOffsetRef.current },
        );
        if (generation !== loadGenerationRef.current) return;
        if (chunk == null) {
          if (append) setCatalogHasMore(false);
          emitArtistsBrowseDebug('catalog_chunk_null', { append });
          return;
        }
        if (append) {
          setCatalogArtists(prev => {
            const merged = dedupeById([...prev, ...chunk.artists]);
            catalogOffsetRef.current = merged.length;
            return merged;
          });
        } else {
          setCatalogArtists(chunk.artists);
          catalogOffsetRef.current = chunk.artists.length;
        }
        setCatalogHasMore(chunk.hasMore);
        emitArtistsBrowseDebug('catalog_chunk_done', {
          append,
          artistCount: chunk.artists.length,
          hasMore: chunk.hasMore,
        });
        return;
      }
      const chunk = await artistBrowseTimed(
        'local_catalog_chunk',
        () => fetchLocalArtistCatalogChunk(
          serverId,
          catalogOffsetRef.current,
          ARTIST_CATALOG_CHUNK_SIZE,
          creditMode,
          letterFilter,
          { libraryScopes: libraryScopesRef.current },
        ),
        { append, offset: catalogOffsetRef.current, creditMode, letterFilter },
      );
      if (generation !== loadGenerationRef.current) return;
      if (chunk == null) {
        if (append) setCatalogHasMore(false);
        emitArtistsBrowseDebug('catalog_chunk_null', { append });
        return;
      }
      if (append) {
        setCatalogArtists(prev => {
          const merged = dedupeById([...prev, ...chunk.artists]);
          catalogOffsetRef.current = merged.length;
          return merged;
        });
      } else {
        setCatalogArtists(chunk.artists);
        catalogOffsetRef.current = chunk.artists.length;
      }
      setCatalogHasMore(chunk.hasMore);
      setBrowseMode('slice');
      emitArtistsBrowseDebug('catalog_chunk_done', {
        append,
        artistCount: chunk.artists.length,
        hasMore: chunk.hasMore,
      });
    } finally {
      catalogLoadingRef.current = false;
      if (generation === loadGenerationRef.current) {
        setCatalogLoadingMore(false);
      }
    }
  }, [creditMode, ignoredArticles, letterFilter, offlineBrowseActive, serverId]);

  useEffect(() => {
    let cancelled = false;
    const loadKey = catalogLoadKey;
    const previousView = catalogViewRef.current;
    catalogViewRef.current = { viewKey: catalogViewKey, syncRevision: librarySyncRevision };

    if (readArtistBrowseCatalogCache(loadKey)) {
      return () => {
        cancelled = true;
      };
    }

    if (
      !offlineBrowseActive
      && indexEnabled
      && serverId
      && browseModeRef.current === 'slice'
      && catalogArtistsRef.current.length > 0
      && isSyncOnlyCatalogChange(previousView, catalogViewKey, librarySyncRevision)
    ) {
      const generation = ++loadGenerationRef.current;
      // The bump drops any in-flight append, which then can no longer clear
      // its own loading state.
      catalogLoadingRef.current = false;
      setCatalogLoadingMore(false);
      void refetchCatalogWindow<SubsonicArtist>(
        starredOnly ? 1 : Math.max(catalogArtistsRef.current.length, ARTIST_CATALOG_CHUNK_SIZE),
        starredOnly ? 10_000 : ARTIST_CATALOG_CHUNK_SIZE,
        async (offset, chunkSize) => {
          const chunk = await fetchLocalArtistCatalogChunk(
            serverId,
            offset,
            chunkSize,
            creditMode,
            starredOnly ? undefined : letterFilter,
            {
              libraryScopes: libraryScopesRef.current,
              ...(starredOnly ? { starredOnly: true } : {}),
            },
          );
          return chunk && { items: chunk.artists, hasMore: chunk.hasMore };
        },
      ).catch(() => null).then(refreshed => {
        if (cancelled || generation !== loadGenerationRef.current || refreshed == null) return;
        const hasMore = !starredOnly && refreshed.hasMore;
        setCatalogArtists(refreshed.items);
        catalogOffsetRef.current = refreshed.items.length;
        setCatalogHasMore(hasMore);
        if (!starredOnly) {
          storeArtistBrowseCatalogCache(loadKey, { artists: refreshed.items, hasMore });
        }
        emitArtistsBrowseDebug('sync_refresh_done', { artistCount: refreshed.items.length });
      });
      return () => {
        cancelled = true;
      };
    }

    const bootKey = artistBrowseCatalogCacheKey(
      loadKey,
      ARTIST_BROWSE_BOOTSTRAP_CHUNK,
      ARTIST_CATALOG_CHUNK_SIZE,
    );
    const joinInflight =
      artistBrowseCatalogInflight(loadKey)
      || (artistBrowseBootstrapEligible(letterFilter, starredOnly)
        && artistBrowseCatalogInflight(bootKey));
    catalogOffsetRef.current = 0;
    catalogLoadingRef.current = false;
    setCatalogArtists([]);
    setCatalogHasMore(false);
    setCatalogLoadingMore(false);
    setBrowseMode('network');
    setLoading(true);
    if (joinInflight) {
      emitArtistsBrowseDebug('load_effect_join_inflight', {});
    }

    const generation = ++loadGenerationRef.current;

    emitArtistsBrowseDebug('load_effect_start', {
      serverId,
      indexEnabled,
      libraryFilterVersion: musicLibraryFilterVersion,
      libraryScopeCount: libraryScopesRef.current.length,
      offlineBrowseActive,
      starredOnly,
      creditMode,
      letterFilter,
      joinInflight,
    });

    void (async () => {
      try {
        if (offlineBrowseActive) {
          emitArtistsBrowseDebug('load_branch', { mode: 'offline' });
          if (!cancelled && generation === loadGenerationRef.current) {
            if (serverId && starredOnly && offlineLocalBrowseEnabled(serverId)) {
              setCatalogArtists(
                (await artistBrowseTimed(
                  'offline_starred',
                  () => fetchOfflineLocalStarredArtists(serverId, creditMode),
                )) ?? [],
              );
            } else if (serverId && !starredOnly && offlineLocalBrowseEnabled(serverId)) {
              const first = await artistBrowseTimed(
                'offline_catalog_initial',
                () => fetchOfflineLocalArtistCatalogChunk(
                  serverId,
                  0,
                  ARTIST_CATALOG_CHUNK_SIZE,
                  creditMode,
                  letterFilter,
                  ignoredArticles,
                ),
              );
              setCatalogArtists(first?.artists ?? []);
              catalogOffsetRef.current = first?.artists.length ?? 0;
              setCatalogHasMore(first?.hasMore ?? false);
            } else {
              setCatalogArtists([]);
              setCatalogHasMore(false);
            }
            setBrowseMode('slice');
            emitArtistsBrowseDebug('load_effect_done', {
              browseMode: 'slice',
              artistCount: catalogOffsetRef.current,
            });
          }
          return;
        }
        if (starredOnly) {
          emitArtistsBrowseDebug('load_branch', { mode: 'starred' });
          if (!cancelled && generation === loadGenerationRef.current) {
            if (indexEnabled && serverId) {
              const loadLocalStars = () => fetchLocalArtistCatalogChunk(
                serverId,
                0,
                10_000,
                creditMode,
                undefined,
                { libraryScopes: libraryScopesRef.current, starredOnly: true },
              );
              const initial = await artistBrowseTimed('starred_catalog_local', loadLocalStars);
              if (cancelled || generation !== loadGenerationRef.current) return;
              if (initial != null) {
                setCatalogArtists(initial.artists);
                catalogOffsetRef.current = initial.artists.length;
                setBrowseMode('slice');
                setCatalogHasMore(false);
                setLoading(false);
                emitArtistsBrowseDebug('load_effect_done', {
                  browseMode: 'slice',
                  artistCount: initial.artists.length,
                  starredOnly: true,
                });

                const scopedServerIds = libraryScopesRef.current.map(scope => scope.serverId);
                const refreshServerIds = [...new Set(
                  scopedServerIds.length > 0 ? scopedServerIds : [serverId],
                )];
                void (async () => {
                  await artistBrowseTimed(
                    'starred_catalog_refresh',
                    () => refreshStarredArtistIndexes(refreshServerIds),
                    { serverCount: refreshServerIds.length },
                  );
                  if (cancelled || generation !== loadGenerationRef.current) return;
                  const refreshed = await artistBrowseTimed(
                    'starred_catalog_local_refreshed',
                    loadLocalStars,
                  );
                  if (cancelled || generation !== loadGenerationRef.current || refreshed == null) {
                    return;
                  }
                  setCatalogArtists(refreshed.artists);
                  catalogOffsetRef.current = refreshed.artists.length;
                  setBrowseMode('slice');
                  setCatalogHasMore(false);
                  emitArtistsBrowseDebug('starred_catalog_refreshed', {
                    artistCount: refreshed.artists.length,
                  });
                })().catch(() => {
                  emitArtistsBrowseDebug('starred_catalog_refresh_error', {});
                });
                return;
              }
            }

            const starred = await artistBrowseTimed(
              'starred_catalog',
              () => fetchStarredArtistsForBrowse(creditMode, serverId, indexEnabled),
            );
            setCatalogArtists(starred);
            catalogOffsetRef.current = starred.length;
            setBrowseMode('network');
            setCatalogHasMore(false);
            emitArtistsBrowseDebug('load_effect_done', {
              browseMode: 'network',
              artistCount: starred.length,
              starredOnly: true,
            });
          }
          return;
        }
        if (indexEnabled && serverId) {
          emitArtistsBrowseDebug('load_branch', { mode: 'slice_try' });
          const bootstrap = artistBrowseBootstrapEligible(letterFilter, starredOnly);
          if (bootstrap) {
            const preview = await fetchArtistBrowseCatalogDeduped(bootKey, () =>
              artistBrowseTimed(
                'local_catalog_bootstrap',
                () => fetchLocalArtistCatalogChunk(
                  serverId,
                  0,
                  ARTIST_BROWSE_BOOTSTRAP_CHUNK,
                  creditMode,
                  letterFilter,
                  { libraryScopes: libraryScopesRef.current },
                ),
                { creditMode, letterFilter, chunkSize: ARTIST_BROWSE_BOOTSTRAP_CHUNK },
              ),
            );
            if (cancelled || generation !== loadGenerationRef.current) return;
            if (preview != null && preview.artists.length > 0) {
              setBrowseMode('slice');
              setCatalogArtists(preview.artists);
              catalogOffsetRef.current = preview.artists.length;
              setCatalogHasMore(preview.hasMore);
              storeArtistBrowseCatalogCache(loadKey, preview);
              setLoading(false);
              emitArtistsBrowseDebug('loading_false', {
                source: 'slice_bootstrap',
                artistCount: preview.artists.length,
              });
              emitArtistsBrowseDebug('load_effect_done', {
                browseMode: 'slice',
                bootstrap: true,
                artistCount: preview.artists.length,
                hasMore: preview.hasMore,
              });
              return;
            }
          }
          const first = await fetchArtistBrowseCatalogDeduped(loadKey, () =>
            artistBrowseTimed(
              'local_catalog_initial',
              () => fetchLocalArtistCatalogChunk(
                serverId,
                0,
                ARTIST_CATALOG_CHUNK_SIZE,
                creditMode,
                letterFilter,
                { libraryScopes: libraryScopesRef.current },
              ),
              { creditMode, letterFilter, chunkSize: ARTIST_CATALOG_CHUNK_SIZE },
            ),
          );
          if (cancelled || generation !== loadGenerationRef.current) return;
          if (first != null) {
            storeArtistBrowseCatalogCache(loadKey, first);
            setBrowseMode('slice');
            setCatalogArtists(first.artists);
            catalogOffsetRef.current = first.artists.length;
            setCatalogHasMore(first.hasMore);
            emitArtistsBrowseDebug('load_effect_done', {
              browseMode: 'slice',
              artistCount: first.artists.length,
              hasMore: first.hasMore,
            });
            return;
          }
          emitArtistsBrowseDebug('slice_fallback', { reason: 'local_chunk_null' });
        }
        if (!cancelled && generation === loadGenerationRef.current && !indexEnabled && !multiServer) {
          emitArtistsBrowseDebug('load_branch', { mode: 'network' });
          const network = await artistBrowseTimed(
            'network_catalog',
            () => fetchNetworkArtistCatalog(creditMode),
            { creditMode },
          );
          setCatalogArtists(network);
          setBrowseMode('network');
          emitArtistsBrowseDebug('load_effect_done', {
            browseMode: 'network',
            artistCount: network.length,
          });
        } else if (
          !cancelled
          && generation === loadGenerationRef.current
          && indexEnabled
        ) {
          setBrowseMode('slice');
          setCatalogArtists([]);
          setCatalogHasMore(false);
          emitArtistsBrowseDebug('load_effect_done', {
            browseMode: 'slice',
            artistCount: 0,
            localUnavailable: true,
          });
        }
      } catch {
        emitArtistsBrowseDebug('load_effect_error', {});
      } finally {
        if (generation === loadGenerationRef.current) {
          setLoading(false);
          emitArtistsBrowseDebug('loading_false', {
            artistCount: catalogOffsetRef.current,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [catalogLoadKey, catalogViewKey, librarySyncRevision, creditMode, ignoredArticles, letterFilter, musicLibraryFilterVersion, indexEnabled, multiServer, offlineBrowseActive, offlineBrowseReloadTs, serverId, starredOnly]);

  return {
    catalogArtists,
    loading,
    catalogHasMore,
    catalogLoadingMore,
    browseMode,
    loadCatalogChunk,
    catalogLoadingRef,
  };
}
