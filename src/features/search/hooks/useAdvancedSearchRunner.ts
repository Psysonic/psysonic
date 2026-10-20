import { useAuthStore } from '@/store/authStore';
import { serverHasExternalCatalog } from '@/lib/server/externalCatalog';
import { nextCatalogSearchPage, type CatalogSearchSource } from '@/lib/library/catalogSearch';
import { useRef, useCallback, type Dispatch, type SetStateAction } from 'react';
import { getAlbumsByGenreForServer } from '@/lib/api/subsonicGenres';
import {
  searchForServer,
  searchSongsPagedForServer,
} from '@/lib/api/subsonicSearch';
import { getRandomSongsForServer } from '@/lib/api/subsonicLibrary';
import type { SubsonicArtist, SubsonicAlbum, SubsonicSong } from '@/lib/api/subsonicTypes';
import {
  loadMoreLocalSongs,
  runNetworkAdvancedTextSearch,
  runNetworkAdvancedYearAlbums,
  tryRunLocalAdvancedSearch,
} from '@/lib/library/advancedSearchLocal';
import { isLosslessSuffix } from '@/lib/library/losslessFormats';
import { OXIMEDIA_MOOD_SEARCH_ENABLED } from '@/lib/library/trackEnrichment';
import { raceSearchSources } from '@/lib/library/searchRace';
import { logLibrarySearch } from '@/lib/library/libraryDevLog';
import {
  browseRaceCountsFullSearch,
  loadMoreLocalBrowseSongs,
  raceBrowseWithLocalFallback,
  runLocalBrowseFullSearch,
  runNetworkBrowseFullSearch,
} from '@/lib/library/browseTextSearch';
import type { SearchOpts, Results } from '@/features/search/searchBrowseTypes';
import {
  getLibraryBrowseScope,
  type LibraryBrowseScope,
} from '@/lib/library/libraryBrowseScope';
import { readyLibraryServerKeys } from '@/lib/library/libraryReady';
import { dedupeById } from '@/lib/util/dedupeById';

const MOOD_UI_ENABLED = OXIMEDIA_MOOD_SEARCH_ENABLED;

// Pagination — basic quick search uses smaller pages than advanced form search.
const BASIC_SONGS_INITIAL = 50;
const BASIC_SONGS_PAGE_SIZE = 50;
const SONGS_INITIAL = 100;
const SONGS_PAGE_SIZE = 50;

function applySongFilters(
  list: SubsonicSong[],
  g: string,
  from: number | null,
  to: number | null,
  bpmLo: number | null,
  bpmHi: number | null,
  lossless = false,
): SubsonicSong[] {
  let r = list;
  if (g) r = r.filter(s => s.genre?.toLowerCase() === g.toLowerCase());
  if (from !== null) r = r.filter(s => !s.year || s.year >= from);
  if (to !== null) r = r.filter(s => !s.year || s.year <= to);
  if (bpmLo !== null) r = r.filter(s => s.bpm != null && s.bpm > 0 && s.bpm >= bpmLo);
  if (bpmHi !== null) r = r.filter(s => s.bpm != null && s.bpm > 0 && s.bpm <= bpmHi);
  if (lossless) r = r.filter(s => isLosslessSuffix(s.suffix));
  return r;
}

function catalogSearchSources(opts: SearchOpts, scope: LibraryBrowseScope, indexEnabled: boolean): CatalogSearchSource[] | null {
  const servers = scope.serverIds.filter(id => serverHasExternalCatalog(useAuthStore.getState(), id));
  if (!servers.length || !opts.query.trim() || opts.bpmFrom || opts.bpmTo || opts.moodGroup || opts.losslessOnly) return null;
  const sources: CatalogSearchSource[] = servers.map(serverId => ({
    offset: 0, hasMore: true,
    run: async (offset, limit) => {
      if (!offset) {
        const page = await runNetworkAdvancedTextSearch(opts, limit, serverId, 30000);
        return page ? { ...page, consumed: page.songsConsumed } : null;
      }
      const songs = await searchSongsPagedForServer(serverId, opts.query.trim(), limit, offset);
      return {
        artists: [], albums: [], consumed: songs.length,
        songs: opts.resultType === 'artists' || opts.resultType === 'albums' ? [] : applySongFilters(
          songs, opts.genre,
          opts.yearFrom ? parseInt(opts.yearFrom, 10) : null,
          opts.yearTo ? parseInt(opts.yearTo, 10) : null,
          null, null,
        ),
      };
    },
  }));
  if (indexEnabled && scope.anchorServerId) {
    const serverId = scope.anchorServerId;
    sources.push({
      offset: 0, hasMore: true,
      run: async (offset, limit) => {
        if (!offset) {
          const page = await tryRunLocalAdvancedSearch(serverId, opts, limit, true, scope);
          return page ? { ...page, consumed: page.songsConsumed } : null;
        }
        const songs = await loadMoreLocalSongs(serverId, opts, offset, limit, scope);
        return { artists: [], albums: [], songs, consumed: songs.length };
      },
    });
  }
  return sources;
}

interface UseAdvancedSearchRunnerParams {
  serverId: string | null;
  indexEnabled: boolean;
  librarySyncRevision: number;
  loadingMoreSongs: boolean;
  songsHasMore: boolean;
  activeSearch: SearchOpts | null;
  basicSearchMode: boolean;
  localMode: boolean;
  songsServerOffset: number;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setHasSearched: Dispatch<SetStateAction<boolean>>;
  setGenreNote: Dispatch<SetStateAction<boolean>>;
  setBasicSearchMode: Dispatch<SetStateAction<boolean>>;
  setQuery: Dispatch<SetStateAction<string>>;
  setActiveSearch: Dispatch<SetStateAction<SearchOpts | null>>;
  setSongsServerOffset: Dispatch<SetStateAction<number>>;
  setSongsHasMore: Dispatch<SetStateAction<boolean>>;
  setLocalMode: Dispatch<SetStateAction<boolean>>;
  setResults: Dispatch<SetStateAction<Results | null>>;
  setLoadingMoreSongs: Dispatch<SetStateAction<boolean>>;
  onResultsCommitted: (scopeFingerprint: string, syncRevision: number) => void;
}

/**
 * The search-execution engine for the search shell: basic quick search, advanced form
 * search (local-index/network race with filters + logging), and song pagination. Owns the
 * run-id staleness guard; the shell owns the result/filter state passed in via setters.
 */
export function useAdvancedSearchRunner({
  indexEnabled,
  librarySyncRevision,
  loadingMoreSongs,
  songsHasMore,
  activeSearch,
  basicSearchMode,
  localMode,
  songsServerOffset,
  setLoading,
  setHasSearched,
  setGenreNote,
  setBasicSearchMode,
  setQuery,
  setActiveSearch,
  setSongsServerOffset,
  setSongsHasMore,
  setLocalMode,
  setResults,
  setLoadingMoreSongs,
  onResultsCommitted,
}: UseAdvancedSearchRunnerParams) {
  const searchRunRef = useRef(0);
  const catalogSourcesRef = useRef<CatalogSearchSource[] | null>(null);
  const resultScopeRef = useRef<LibraryBrowseScope | null>(getLibraryBrowseScope());

  const runBasicSearch = async (rawQuery: string) => {
    const q = rawQuery.trim();
    const runId = ++searchRunRef.current;
    catalogSourcesRef.current = null;
    const isStale = () => runId !== searchRunRef.current;
    const browseScope = getLibraryBrowseScope();
    const searchServerId = browseScope.anchorServerId;
    const commitResults = (next: Results | null) => {
      resultScopeRef.current = browseScope;
      onResultsCommitted(browseScope.fingerprint, librarySyncRevision);
      setResults(next);
    };
    const clearResultsForScopeChange = () => {
      commitResults(q ? { artists: [], albums: [], songs: [] } : null);
      setSongsServerOffset(0);
      setSongsHasMore(false);
      setLocalMode(false);
    };
    const pendingSearch: SearchOpts = {
      query: q,
      genre: '',
      yearFrom: '',
      yearTo: '',
      bpmFrom: '',
      bpmTo: '',
      moodGroup: '',
      losslessOnly: false,
      resultType: 'all',
    };
    let multiServerResult: Results | null = null;

    setHasSearched(true);
    setGenreNote(false);
    setBasicSearchMode(true);
    setQuery(q);
    setActiveSearch(pendingSearch);
    setLoading(false);
    setLoadingMoreSongs(false);

    if (!searchServerId) {
      commitResults(q ? { artists: [], albums: [], songs: [] } : null);
      setSongsServerOffset(0);
      setSongsHasMore(false);
      setLocalMode(false);
      return;
    }

    const catalogSources = catalogSearchSources(pendingSearch, browseScope, indexEnabled);
    if (catalogSources) {
      setLoading(true);
      setSongsHasMore(false);
      setLocalMode(false);
      try {
        const page = await nextCatalogSearchPage(catalogSources, BASIC_SONGS_INITIAL);
        if (isStale()) return;
        catalogSourcesRef.current = catalogSources;
        commitResults(page.results);
        setSongsHasMore(page.hasMore);
      } catch {
        if (!isStale()) commitResults(null);
      } finally {
        if (!isStale()) setLoading(false);
      }
      return;
    }

    if (
      q
      && searchServerId
      && indexEnabled
      && browseScope.multiServer
    ) {
      if ((await readyLibraryServerKeys(browseScope.serverIds)) == null) {
        if (resultScopeRef.current?.fingerprint !== browseScope.fingerprint) {
          clearResultsForScopeChange();
        }
        return;
      }
      try {
        multiServerResult = await runLocalBrowseFullSearch(
          searchServerId,
          q,
          BASIC_SONGS_INITIAL,
          browseScope,
        );
      } catch {
        return;
      }
      if (isStale() || !multiServerResult) return;
    }
    if (isStale()) return;

    setLoading(true);
    setSongsServerOffset(0);
    setSongsHasMore(false);
    setLocalMode(false);

    if (!q) {
      commitResults(null);
      setLoading(false);
      return;
    }

    try {
      if (searchServerId && indexEnabled) {
        if (browseScope.multiServer) {
          const result = multiServerResult;
          if (!result) return;
          commitResults(result);
          setSongsServerOffset(result.songs.length);
          setSongsHasMore(result.songs.length >= BASIC_SONGS_INITIAL);
          setLocalMode(true);
          return;
        }
        const outcome = await raceBrowseWithLocalFallback(
          isStale,
          () => runLocalBrowseFullSearch(searchServerId, q, BASIC_SONGS_INITIAL, browseScope),
          () => runNetworkBrowseFullSearch(q, BASIC_SONGS_INITIAL, searchServerId),
          {
            surface: 'search_results',
            query: q,
            indexEnabled,
            counts: browseRaceCountsFullSearch,
          },
        );
        if (isStale()) return;
        if (outcome) {
          commitResults(outcome.result);
          setSongsServerOffset(outcome.result.songs.length);
          setSongsHasMore(outcome.result.songs.length >= BASIC_SONGS_INITIAL);
          setLocalMode(outcome.source === 'local');
          return;
        }
      }

      const network = await runNetworkBrowseFullSearch(q, BASIC_SONGS_INITIAL, searchServerId);
      if (isStale()) return;
      if (network) {
        commitResults(network);
        setSongsServerOffset(network.songs.length);
        setSongsHasMore(network.songs.length >= BASIC_SONGS_INITIAL);
      } else {
        commitResults({ artists: [], albums: [], songs: [] });
      }
    } catch {
      if (!isStale()) commitResults(null);
    } finally {
      if (!isStale()) setLoading(false);
    }
  };

  const runSearch = async (opts: SearchOpts) => {
    const runId = ++searchRunRef.current;
    catalogSourcesRef.current = null;
    const isStale = () => runId !== searchRunRef.current;
    const q = opts.query.trim();
    const browseScope = getLibraryBrowseScope();
    const searchServerId = browseScope.anchorServerId;
    const commitResults = (next: Results) => {
      resultScopeRef.current = browseScope;
      onResultsCommitted(browseScope.fingerprint, librarySyncRevision);
      setResults(next);
    };
    const clearResultsForScopeChange = () => {
      commitResults({ artists: [], albums: [], songs: [] });
      setSongsServerOffset(0);
      setSongsHasMore(false);
      setLocalMode(false);
    };
    let multiServerPage: Awaited<ReturnType<typeof tryRunLocalAdvancedSearch>> = null;

    setHasSearched(true);
    setGenreNote(false);
    setBasicSearchMode(false);
    setActiveSearch(opts);
    setLoading(false);
    setLoadingMoreSongs(false);

    if (!searchServerId) {
      commitResults({ artists: [], albums: [], songs: [] });
      setSongsServerOffset(0);
      setSongsHasMore(false);
      setLocalMode(false);
      return;
    }

    const catalogSources = catalogSearchSources(opts, browseScope, indexEnabled);
    if (catalogSources) {
      setLoading(true);
      setSongsHasMore(false);
      setLocalMode(false);
      try {
        const page = await nextCatalogSearchPage(catalogSources, SONGS_INITIAL);
        if (isStale()) return;
        catalogSourcesRef.current = catalogSources;
        commitResults(page.results);
        setSongsHasMore(page.hasMore);
      } catch {
        if (!isStale()) commitResults({ artists: [], albums: [], songs: [] });
      } finally {
        if (!isStale()) setLoading(false);
      }
      return;
    }

    if (
      searchServerId
      && indexEnabled
      && browseScope.multiServer
    ) {
      if ((await readyLibraryServerKeys(browseScope.serverIds)) == null) {
        if (resultScopeRef.current?.fingerprint !== browseScope.fingerprint) {
          clearResultsForScopeChange();
        }
        return;
      }
      try {
        multiServerPage = await tryRunLocalAdvancedSearch(
          searchServerId,
          opts,
          SONGS_INITIAL,
          false,
          browseScope,
        );
      } catch {
        return;
      }
      if (isStale() || !multiServerPage) return;
    }
    if (isStale()) return;

    setLoading(true);
    setSongsServerOffset(0);
    setSongsHasMore(false);
    const searchT0 = performance.now();
    const moodFilterActive = MOOD_UI_ENABLED && !!opts.moodGroup;
    const bpmFilterActive = !!(opts.bpmFrom || opts.bpmTo);
    const losslessFilterActive = opts.losslessOnly;
    const trackOnlyFilterActive = moodFilterActive || bpmFilterActive;

    // Track-only filters (BPM dual-storage, mood) need the local index for full coverage.
    // Lossless skips the race — network search3 cannot filter albums by format reliably.
    if (searchServerId && indexEnabled && browseScope.multiServer) {
      const page = multiServerPage;
      if (!page) return;
      commitResults({ artists: page.artists, albums: page.albums, songs: page.songs });
      setSongsServerOffset(page.songsConsumed);
      setSongsHasMore(page.songsConsumed >= SONGS_INITIAL);
      setLocalMode(true);
      setLoading(false);
      return;
    }

    if (q && searchServerId && indexEnabled && !trackOnlyFilterActive && !losslessFilterActive) {
      try {
        const winner = await raceSearchSources(
          [
            {
              source: 'local',
              run: () => tryRunLocalAdvancedSearch(
                searchServerId,
                opts,
                SONGS_INITIAL,
                true,
                browseScope,
              ),
            },
            {
              source: 'network',
              run: () => runNetworkAdvancedTextSearch(opts, SONGS_INITIAL, searchServerId),
            },
          ],
          isStale,
        );
        if (isStale()) return;
        if (winner) {
          commitResults({
            artists: winner.result.artists,
            albums: winner.result.albums,
            songs: winner.result.songs,
          });
          setSongsServerOffset(winner.result.songsConsumed);
          setSongsHasMore(winner.result.songsConsumed >= SONGS_INITIAL);
          setLocalMode(winner.source === 'local');
          logLibrarySearch({
            at: new Date().toISOString(),
            query: q,
            path: 'search_race',
            surface: 'advanced_search',
            durationMs: Math.round(performance.now() - searchT0),
            indexEnabled,
            raceWinner: winner.source,
            raceWinnerMs: winner.durationMs,
            counts: {
              artists: winner.result.artists.length,
              albums: winner.result.albums.length,
              songs: winner.result.songs.length,
            },
          });
          setLoading(false);
          return;
        }
      } catch {
        if (isStale()) return;
      }
      setLocalMode(false);
    } else if (searchServerId && indexEnabled) {
      const localPage = await tryRunLocalAdvancedSearch(
        searchServerId,
        opts,
        SONGS_INITIAL,
        false,
        browseScope,
      );
      if (isStale()) return;
      if (localPage) {
        commitResults({
          artists: localPage.artists,
          albums: localPage.albums,
          songs: localPage.songs,
        });
        setSongsServerOffset(localPage.songsConsumed);
        setSongsHasMore(localPage.songsConsumed >= SONGS_INITIAL);
        setLocalMode(true);
        setLoading(false);
        return;
      }
      if (trackOnlyFilterActive) {
        commitResults({ artists: [], albums: [], songs: [] });
        setLoading(false);
        return;
      }
      setLocalMode(false);
    } else {
      setLocalMode(false);
    }

    if ((trackOnlyFilterActive || losslessFilterActive) && !indexEnabled) {
      commitResults({ artists: [], albums: [], songs: [] });
      setLoading(false);
      return;
    }

    const { genre: g, yearFrom: yf, yearTo: yt, bpmFrom: bf, bpmTo: bt, losslessOnly: lossless, resultType: rt } = opts;
    const from = yf ? parseInt(yf) : null;
    const to = yt ? parseInt(yt) : null;
    const bpmLo = bf ? parseInt(bf) : null;
    const bpmHi = bt ? parseInt(bt) : null;

    let artists: SubsonicArtist[] = [];
    let albums: SubsonicAlbum[] = [];
    let songs: SubsonicSong[] = [];

    try {
      if (q.trim()) {
        const searchOptions = { artistCount: 30, albumCount: 50, songCount: SONGS_INITIAL };
        const r = await searchForServer(searchServerId, q.trim(), searchOptions);
        if (isStale()) return;
        artists = r.artists;
        albums = r.albums;
        songs = applySongFilters(r.songs, g, from, to, bpmLo, bpmHi, lossless);

        if (g) {
          albums = albums.filter(a => a.genre?.toLowerCase() === g.toLowerCase());
        }
        if (from !== null) {
          albums = albums.filter(a => !a.year || a.year >= from);
        }
        if (to !== null) {
          albums = albums.filter(a => !a.year || a.year <= to);
        }
        if (lossless) {
          const albumIds = new Set(songs.map(s => s.albumId).filter(Boolean));
          albums = albums.filter(a => albumIds.has(a.id));
          const artistIds = new Set(songs.map(s => s.artistId).filter(Boolean));
          artists = artists.filter(a => artistIds.has(a.id));
        }

        // Only the free-text branch supports server-side pagination via search3 offset.
        // If the server returned a full page, more probably exist.
        setSongsServerOffset(r.songs.length);
        setSongsHasMore(r.songs.length === SONGS_INITIAL);
      } else if (g) {
        const [albumRes, songRes] = await Promise.all([
          rt === 'songs' || rt === 'artists'
            ? Promise.resolve([])
            : getAlbumsByGenreForServer(searchServerId, g, 50),
          rt === 'albums' || rt === 'artists'
            ? Promise.resolve([])
            : getRandomSongsForServer(searchServerId, 100, g),
        ]);
        if (isStale()) return;
        albums = albumRes as SubsonicAlbum[];
        songs = songRes as SubsonicSong[];
        songs = applySongFilters(songs, g, from, to, bpmLo, bpmHi, lossless);
        if (from !== null) albums = albums.filter(a => !a.year || a.year >= from);
        if (to !== null) albums = albums.filter(a => !a.year || a.year <= to);
        if (songs.length > 0) setGenreNote(true);
      } else if (from !== null || to !== null) {
        if (rt !== 'artists' && rt !== 'songs') {
          albums = await runNetworkAdvancedYearAlbums(opts, 100, searchServerId);
          if (isStale()) return;
        }
      }

      const finalResults = {
        artists: rt === 'albums' || rt === 'songs' ? [] : artists,
        albums: rt === 'artists' || rt === 'songs' ? [] : albums,
        songs: rt === 'artists' || rt === 'albums' ? [] : songs,
      };
      if (isStale()) return;
      commitResults(finalResults);
      if (q.trim()) {
        logLibrarySearch({
          at: new Date().toISOString(),
          query: q,
          path: 'search3',
          surface: 'advanced_search',
          source: 'network',
          durationMs: Math.round(performance.now() - searchT0),
          indexEnabled,
          counts: {
            artists: finalResults.artists.length,
            albums: finalResults.albums.length,
            songs: finalResults.songs.length,
          },
        });
      }
    } catch {
      if (isStale()) return;
      commitResults({ artists: [], albums: [], songs: [] });
    }
    if (!isStale()) setLoading(false);
  };

  const loadMoreSongs = useCallback(async () => {
    if (loadingMoreSongs || !songsHasMore || !activeSearch) return;
    const runId = searchRunRef.current;
    const isStale = () => runId !== searchRunRef.current;
    const browseScope = resultScopeRef.current ?? getLibraryBrowseScope();
    const searchServerId = browseScope.anchorServerId;
    if (!searchServerId) {
      setSongsHasMore(false);
      return;
    }

    if (catalogSourcesRef.current) {
      const sources = catalogSourcesRef.current;
      setLoadingMoreSongs(true);
      try {
        const page = await nextCatalogSearchPage(sources, SONGS_PAGE_SIZE);
        if (isStale()) return;
        setResults(prev => prev ? { ...prev, songs: dedupeById([...prev.songs, ...page.results.songs]) } : prev);
        setSongsHasMore(page.hasMore);
      } catch {
        if (!isStale()) setSongsHasMore(false);
      } finally {
        if (!isStale()) setLoadingMoreSongs(false);
      }
      return;
    }

    if (basicSearchMode) {
      const q = activeSearch.query.trim();
      if (!q) return;
      setLoadingMoreSongs(true);
      try {
        const page = localMode
          ? await loadMoreLocalBrowseSongs(
              searchServerId,
              q,
              songsServerOffset,
              BASIC_SONGS_PAGE_SIZE,
              browseScope,
            )
          : await searchSongsPagedForServer(
              searchServerId,
              q,
              BASIC_SONGS_PAGE_SIZE,
              songsServerOffset,
            );
        if (isStale()) return;
        setResults(prev => prev ? { ...prev, songs: dedupeById([...prev.songs, ...page]) } : prev);
        setSongsServerOffset(o => o + page.length);
        if (page.length < BASIC_SONGS_PAGE_SIZE) setSongsHasMore(false);
      } catch {
        if (!isStale()) setSongsHasMore(false);
      } finally {
        if (!isStale()) setLoadingMoreSongs(false);
      }
      return;
    }

    // Local mode pages every result type (genre/year too), not just free-text.
    if (localMode) {
      if (!searchServerId) return;
      setLoadingMoreSongs(true);
      try {
        const more = await loadMoreLocalSongs(
          searchServerId,
          activeSearch,
          songsServerOffset,
          SONGS_PAGE_SIZE,
          browseScope,
        );
        if (isStale()) return;
        setResults(prev => (prev ? { ...prev, songs: dedupeById([...prev.songs, ...more]) } : prev));
        setSongsServerOffset(o => o + more.length);
        if (more.length < SONGS_PAGE_SIZE) setSongsHasMore(false);
      } catch {
        if (!isStale()) setSongsHasMore(false);
      } finally {
        if (!isStale()) setLoadingMoreSongs(false);
      }
      return;
    }

    if (!activeSearch.query.trim()) return;
    setLoadingMoreSongs(true);
    try {
      const q = activeSearch.query.trim();
      const g = activeSearch.genre;
      const from = activeSearch.yearFrom ? parseInt(activeSearch.yearFrom) : null;
      const to = activeSearch.yearTo ? parseInt(activeSearch.yearTo) : null;
      const bpmLo = activeSearch.bpmFrom ? parseInt(activeSearch.bpmFrom) : null;
      const bpmHi = activeSearch.bpmTo ? parseInt(activeSearch.bpmTo) : null;
      const page = await searchSongsPagedForServer(
        searchServerId,
        q,
        SONGS_PAGE_SIZE,
        songsServerOffset,
      );
      if (isStale()) return;
      const filtered = applySongFilters(
        page,
        g,
        from,
        to,
        bpmLo,
        bpmHi,
        activeSearch.losslessOnly,
      );
      setResults(prev => prev ? {
        ...prev,
        songs: dedupeById([...prev.songs, ...filtered]),
      } : prev);
      setSongsServerOffset(o => o + page.length);
      // No more pages when the server returned a non-full page (regardless of how many survived filtering).
      if (page.length < SONGS_PAGE_SIZE) setSongsHasMore(false);
    } catch {
      if (!isStale()) setSongsHasMore(false);
    } finally {
      if (!isStale()) setLoadingMoreSongs(false);
    }
  }, [
    loadingMoreSongs, songsHasMore, activeSearch, songsServerOffset, localMode, basicSearchMode,
    setResults, setSongsServerOffset, setSongsHasMore, setLoadingMoreSongs,
  ]);

  return { runBasicSearch, runSearch, loadMoreSongs };
}
