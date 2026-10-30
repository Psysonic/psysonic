import { serverHasExternalCatalog } from '@/lib/server/externalCatalog';
import { useRef, useEffect, useCallback, useMemo, useState, type Dispatch, type SetStateAction, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { subscribeLibrarySyncProgress } from '@/lib/api/library';
import type { SearchResults } from '@/lib/api/subsonicTypes';
import {
  LIVE_SEARCH_DEBOUNCE_NETWORK_MS,
  LIVE_SEARCH_DEBOUNCE_RACE_MS,
  EMPTY_SEARCH_RESULTS,
  liveSearchQueryRejected,
  mergeLiveSearchResults,
  runLocalLiveSearch,
  runNetworkLiveSearch,
} from '@/lib/library/liveSearchLocal';
import { raceLiveSearch } from '@/lib/library/searchRace';
import { readyLibraryServerKeys } from '@/lib/library/libraryReady';
import {
  emitLiveSearchDebug,
  searchHitCounts,
  searchResultSamples,
} from '@/lib/library/liveSearchDebug';
import { logLibrarySearch } from '@/lib/library/libraryDevLog';
import { resolveIndexKey } from '@/lib/server/serverIndexKey';
import { showToast } from '@/lib/dom/toast';
import { useAuthStore } from '@/store/authStore';
import { useLibraryIndexStore } from '@/store/libraryIndexStore';
import type { LiveSearchScope } from '@/store/liveSearchScopeStore';
import { isLiveSearchDropdownBlocked } from '@/features/search/components/liveSearchScope';
import type { useShareSearch } from '@/features/search/hooks/useShareSearch';
import type { LiveSearchSource } from '@/features/search/components/LiveSearchDropdown';
import { getLibraryBrowseScope } from '@/lib/library/libraryBrowseScope';
import { useLibraryScopeSyncRevision } from '@/store/offlineLocalLibrarySyncRevision';

interface UseLiveSearchQueryParams {
  query: string;
  scope: LiveSearchScope | null;
  shareMatch: ReturnType<typeof useShareSearch>['shareMatch'];
  /** Generation counter for in-flight cancellation; the component also bumps it on route leave. */
  liveSearchGenRef: MutableRefObject<number>;
  setResults: Dispatch<SetStateAction<SearchResults | null>>;
  setOpen: Dispatch<SetStateAction<boolean>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setSearchSource: Dispatch<SetStateAction<LiveSearchSource | null>>;
  setActiveIndex: Dispatch<SetStateAction<number>>;
}

/**
 * Runs the debounced live-search query (local-index/network race, merge, logging) and
 * pushes the results into the caller's state setters. Owns the local-ready cache that the
 * race logging reads; the overlay/keyboard/render state stays in the component.
 */
export function useLiveSearchQuery({
  query,
  scope,
  shareMatch,
  liveSearchGenRef,
  setResults,
  setOpen,
  setLoading,
  setSearchSource,
  setActiveIndex,
}: UseLiveSearchQueryParams) {
  const { t } = useTranslation();
  const serverId = useAuthStore(s => s.activeServerId);
  const musicLibraryFilterVersion = useAuthStore(s => s.musicLibraryFilterVersion);
  const libraryBrowseScopeVersion = useAuthStore(s => s.libraryBrowseScopeVersion);
  const browseScopeSnapshot = useMemo(() => {
    // The scope version is the invalidation token for this imperative store snapshot.
    void libraryBrowseScopeVersion;
    void serverId;
    return getLibraryBrowseScope();
  }, [libraryBrowseScopeVersion, serverId]);
  const searchServerId = browseScopeSnapshot.anchorServerId;
  const indexEnabled = useLibraryIndexStore(s => s.isIndexEnabled(searchServerId));
  const readinessServerIds = useMemo(() => (
    browseScopeSnapshot.serverIds.length > 0
      ? browseScopeSnapshot.serverIds
      : []
  ), [browseScopeSnapshot]);
  const readinessScopeKey = readinessServerIds.join(',');
  const librarySyncRevision = useLibraryScopeSyncRevision(readinessServerIds);
  const localReadyRef = useRef(false);
  const readinessGenerationRef = useRef(0);
  const resultScopeFingerprintRef = useRef(browseScopeSnapshot.fingerprint);
  const [indexIncomplete, setIndexIncomplete] = useState(false);

  const refreshIndexStatus = useCallback(async () => {
    const generation = ++readinessGenerationRef.current;
    if (!searchServerId || !indexEnabled) {
      localReadyRef.current = false;
      setIndexIncomplete(false);
      return;
    }
    try {
      const ready = (await readyLibraryServerKeys(readinessServerIds)) != null;
      if (generation !== readinessGenerationRef.current) return;
      localReadyRef.current = ready;
      setIndexIncomplete(!ready);
    } catch {
      if (generation !== readinessGenerationRef.current) return;
      localReadyRef.current = false;
      setIndexIncomplete(false);
    }
  }, [searchServerId, indexEnabled, readinessScopeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // React Compiler set-state-in-effect rule: state set from an async result resolved in this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshIndexStatus();
  }, [refreshIndexStatus, musicLibraryFilterVersion, librarySyncRevision]);

  useEffect(() => {
    if (!indexEnabled || !searchServerId) return;
    let disposed = false;
    let unlistenProgress: (() => void) | undefined;
    const indexKeys = new Set(readinessServerIds.map(resolveIndexKey));
    void subscribeLibrarySyncProgress(p => {
      if (indexKeys.has(resolveIndexKey(p.serverId)) && p.kind === 'phase_changed') {
        void refreshIndexStatus();
      }
    }).then(fn => {
      if (disposed) {
        fn();
        return;
      }
      unlistenProgress = fn;
    });
    return () => {
      disposed = true;
      unlistenProgress?.();
    };
  }, [indexEnabled, searchServerId, refreshIndexStatus, readinessScopeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isLiveSearchDropdownBlocked(scope)) {
      setResults(null);
      setOpen(false);
      setSearchSource(null);
      setLoading(false);
      return;
    }

    if (shareMatch) {
      setResults(null);
      setLoading(false);
      setSearchSource(null);
      setOpen(true);
      setActiveIndex(-1);
      return;
    }

    const q = query.trim();
    if (!q) {
      setResults(null);
      setOpen(false);
      setSearchSource(null);
      setLoading(false);
      return;
    }

    const abort = new AbortController();
    const debounceMs = indexEnabled ? LIVE_SEARCH_DEBOUNCE_RACE_MS : LIVE_SEARCH_DEBOUNCE_NETWORK_MS;

    const timer = window.setTimeout(() => {
      void (async () => {
        const gen = liveSearchGenRef.current;
        const isStale = () =>
          gen !== liveSearchGenRef.current || abort.signal.aborted;

        if (isStale()) return;
        const browseScope = getLibraryBrowseScope();
        const queryServerId = browseScope.anchorServerId;
        const catalogServers = browseScope.serverIds.filter(id => serverHasExternalCatalog(useAuthStore.getState(), id));
        const runNetwork = async () => {
          if (!catalogServers.length) return runNetworkLiveSearch(q, abort.signal, queryServerId);
          // Octo treats requests for at most 12 songs as library-only typeahead.
          // Request a discovery page, then keep the usual dropdown display limits.
          const settled = await Promise.allSettled(catalogServers.map(id => runNetworkLiveSearch(q, abort.signal, id, 30000, 20)));
          let merged: SearchResults | null = null;
          for (const result of settled) {
            if (result.status === 'fulfilled' && result.value) {
              merged = merged ? mergeLiveSearchResults(merged, result.value) : result.value;
            }
          }
          if (!merged && settled.some(result => result.status === 'rejected')) throw new Error('Catalog search failed');
          return merged;
        };
        const scopeChanged = resultScopeFingerprintRef.current !== browseScope.fingerprint;
        const raceCtx = { epoch: gen, isStale, suppressLog: indexEnabled && !!queryServerId };
        const queryRejected = liveSearchQueryRejected(q);
        let multiServerResult: SearchResults | null = null;

        if (scopeChanged) {
          resultScopeFingerprintRef.current = browseScope.fingerprint;
          setResults(EMPTY_SEARCH_RESULTS);
          setSearchSource(null);
          setOpen(true);
        }

        if (
          !queryRejected
          && indexEnabled
          && queryServerId
          && browseScope.multiServer
          && !catalogServers.length
        ) {
          if ((await readyLibraryServerKeys(readinessServerIds)) == null) return;
          if (isStale()) return;
          try {
            multiServerResult = await runLocalLiveSearch(queryServerId, q, raceCtx, browseScope);
          } catch (err) {
            if (isStale()) return;
            const name = err instanceof Error ? err.name : '';
            if (name !== 'CanceledError' && name !== 'AbortError') {
              showToast(t('search.liveSearchFailed'), 3200, 'error');
            }
            return;
          }
          if (isStale() || !multiServerResult) return;
        }
        if (isStale()) return;

        setSearchSource(null);
        setActiveIndex(-1);
        setLoading(true);
        const searchT0 = performance.now();
        try {
          if (queryRejected) {
            if (!isStale()) {
              setResults(EMPTY_SEARCH_RESULTS);
              setSearchSource(null);
              setOpen(true);
            }
            return;
          }

          if (!queryServerId) {
            setResults(EMPTY_SEARCH_RESULTS);
            setSearchSource(null);
            setOpen(true);
            return;
          }

          if (indexEnabled && queryServerId) {
            if (browseScope.multiServer && !catalogServers.length) {
              if (multiServerResult) {
                setResults(multiServerResult);
                setSearchSource('local');
                setOpen(true);
                return;
              }
            }
            const winner = await raceLiveSearch(
              () => runLocalLiveSearch(queryServerId, q, raceCtx, browseScope),
              runNetwork,
              isStale,
              meta => {
                emitLiveSearchDebug('race_settled', {
                  query: q,
                  winner: meta.winner,
                  localMs: meta.localMs,
                  networkMs: meta.networkMs,
                  localHits: meta.localHits,
                  networkHits: meta.networkHits,
                });
                if (isStale()) return;
                if (meta.localResult && meta.networkResult) {
                  const primary =
                    meta.winner === 'local' ? meta.localResult : meta.networkResult;
                  const supplement =
                    meta.winner === 'local' ? meta.networkResult : meta.localResult;
                  const merged = mergeLiveSearchResults(primary, supplement);
                  const primaryHits = searchHitCounts(primary);
                  const mergedHits = searchHitCounts(merged);
                  if (mergedHits !== primaryHits) {
                    setResults(merged);
                    setSearchSource(meta.winner);
                    emitLiveSearchDebug('race_merged', {
                      query: q,
                      winner: meta.winner,
                      before: primaryHits,
                      after: mergedHits,
                      samples: searchResultSamples(merged),
                    });
                  }
                }
              },
            );
            if (isStale()) return;
            if (winner) {
              setResults(winner.result);
              setSearchSource(winner.source);
              setOpen(true);
              const samples = searchResultSamples(winner.result);
              emitLiveSearchDebug('race_winner', {
                query: q,
                winner: winner.source,
                raceMs: winner.durationMs,
                hits: searchHitCounts(winner.result),
                samples,
                path: 'search_race',
                localReady: localReadyRef.current,
              });
              logLibrarySearch({
                at: new Date().toISOString(),
                query: q,
                path: 'search_race',
                surface: 'live_search',
                durationMs: Math.round(performance.now() - searchT0),
                debounceMs,
                indexEnabled,
                localReadyCached: localReadyRef.current,
                raceWinner: winner.source,
                raceWinnerMs: winner.durationMs,
                counts: {
                  artists: winner.result.artists.length,
                  albums: winner.result.albums.length,
                  songs: winner.result.songs.length,
                },
              });
              return;
            }
            showToast(t('search.liveSearchFailed'), 3200, 'error');
          } else if (queryServerId) {
            const network = await runNetwork();
            if (isStale()) return;
            if (network) {
              setResults(network);
              setSearchSource('network');
              setOpen(true);
              logLibrarySearch({
                at: new Date().toISOString(),
                query: q,
                path: 'search3',
                surface: 'live_search',
                source: 'network',
                durationMs: Math.round(performance.now() - searchT0),
                debounceMs,
                indexEnabled,
                counts: {
                  artists: network.artists.length,
                  albums: network.albums.length,
                  songs: network.songs.length,
                },
              });
            }
          }
        } catch (err) {
          if (isStale()) return;
          const name = err instanceof Error ? err.name : '';
          if (name === 'CanceledError' || name === 'AbortError') return;
          showToast(t('search.liveSearchFailed'), 3200, 'error');
        } finally {
          if (!isStale()) setLoading(false);
        }
      })();
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
      abort.abort();
      liveSearchGenRef.current += 1;
    };
  }, [
    query, scope, shareMatch, serverId, indexEnabled, musicLibraryFilterVersion, libraryBrowseScopeVersion, librarySyncRevision, readinessServerIds, t,
    liveSearchGenRef, setResults, setOpen, setLoading, setSearchSource, setActiveIndex,
  ]);

  return { indexIncomplete };
}
