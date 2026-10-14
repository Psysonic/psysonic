import type { SubsonicGenre } from '@/lib/api/subsonicTypes';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { APP_MAIN_SCROLL_VIEWPORT_ID } from '@/constants/appScroll';
import { useAuthStore } from '@/store/authStore';
import { useLibraryIndexStore } from '@/store/libraryIndexStore';
import {
  fetchGenreCatalog,
  fetchScopedGenreCatalog,
  filterGenresWithContent,
  peekScopedGenreCatalog,
} from '@/features/playback/utils/playback/genreBrowsePlayback';
import { libraryScopeCacheKeyForServer } from '@/lib/api/subsonicClient';
import { peekGenreCatalogCache } from '@/lib/library/genreCatalogCountsCache';
import { genreColor } from '@/lib/library/genreColor';
import { useOfflineBrowseContext, offlineLocalBrowseEnabled } from '@/features/offline';
import { useOfflineLocalBrowseReloadKey } from '@/store/localPlaybackBrowseRevision';
import { useLibrarySyncRevision } from '@/store/offlineLocalLibrarySyncRevision';
import { useLocalPlaybackStore } from '@/store/localPlaybackStore';
import { deriveLibraryBrowseIndexScopes } from '@/lib/library/libraryBrowseScope';
import TagCatalogToolbar, { type TagCatalogSort } from '@/ui/TagCatalogToolbar';

const RETURN_STATE_KEY = 'genres-return-state';
const SORT_KEY = 'genres-sort';
const FONT_MIN_REM = 0.78;
const FONT_MAX_REM = 1.7;

interface CatalogReturnState {
  search: string;
  scrollTop: number;
}

function readReturnState(): CatalogReturnState | null {
  const raw = sessionStorage.getItem(RETURN_STATE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CatalogReturnState>;
    if (typeof parsed.search !== 'string' || typeof parsed.scrollTop !== 'number' || !Number.isFinite(parsed.scrollTop)) {
      return null;
    }
    return { search: parsed.search, scrollTop: parsed.scrollTop };
  } catch {
    return null;
  }
}

function readSort(): TagCatalogSort {
  return sessionStorage.getItem(SORT_KEY) === 'alphabetical'
    ? 'alphabetical'
    : 'popularity';
}

export default function Genres() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState(() => readReturnState()?.search ?? '');
  const [sort, setSort] = useState<TagCatalogSort>(readSort);
  const serverId = useAuthStore(s => s.activeServerId ?? '');
  const indexEnabled = useLibraryIndexStore(s => s.isIndexEnabled(serverId));
  const musicLibraryFilterVersion = useAuthStore(s => s.musicLibraryFilterVersion);
  const libraryBrowseScopeVersion = useAuthStore(s => s.libraryBrowseScopeVersion);
  const selectedIndexScopes = deriveLibraryBrowseIndexScopes(useAuthStore.getState());
  const libraryScopeKey = libraryScopeCacheKeyForServer(serverId);
  const offlineBrowseActive = useOfflineBrowseContext().active;
  const localPlaybackEntries = useLocalPlaybackStore(s => s.entries);
  const librarySyncRevision = useLibrarySyncRevision();
  const offlineLocalBrowseReloadKey = useOfflineLocalBrowseReloadKey(
    serverId,
    offlineBrowseActive,
  );
  const skipGenreCatalogCache = offlineBrowseActive
    && offlineLocalBrowseEnabled(serverId, localPlaybackEntries);
  const cachedGenres = !offlineBrowseActive
    ? peekScopedGenreCatalog(selectedIndexScopes, true)
    : serverId && !skipGenreCatalogCache
      ? peekGenreCatalogCache(serverId, libraryScopeKey, true)
      : null;
  const [rawGenres, setRawGenres] = useState<SubsonicGenre[]>(cachedGenres ?? []);
  const [loading, setLoading] = useState(!cachedGenres);

  useEffect(() => {
    let cancelled = false;
    const scopeKey = libraryScopeCacheKeyForServer(serverId);
    const scopes = deriveLibraryBrowseIndexScopes(useAuthStore.getState());
    const useSelectedIndexCounts = scopes.length > 0 && !offlineBrowseActive;
    const cached = useSelectedIndexCounts
      ? peekScopedGenreCatalog(scopes, true)
      : serverId && !skipGenreCatalogCache
        ? peekGenreCatalogCache(serverId, scopeKey, true)
        : null;
    if (cached) {
      // React Compiler set-state-in-effect rule: state set from an async result resolved in this effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRawGenres(cached);
      setLoading(false);
    } else {
      setRawGenres([]);
      setLoading(true);
    }
    const load = useSelectedIndexCounts
      ? fetchScopedGenreCatalog(scopes)
      : fetchGenreCatalog(serverId, indexEnabled);
    void load
      .then(data => {
        if (!cancelled) setRawGenres(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    serverId,
    indexEnabled,
    musicLibraryFilterVersion,
    libraryBrowseScopeVersion,
    offlineBrowseActive,
    skipGenreCatalogCache,
    librarySyncRevision,
    offlineLocalBrowseReloadKey,
  ]);

  const catalogGenres = useMemo(
    () => filterGenresWithContent([...rawGenres]),
    [rawGenres],
  );

  const searchActive = search.trim().length > 0;
  const genres = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = query
      ? catalogGenres.filter(genre => genre.value.toLocaleLowerCase().includes(query))
      : [...catalogGenres];

    return filtered.sort((a, b) => (
      sort === 'alphabetical'
        ? a.value.localeCompare(b.value)
        : b.albumCount - a.albumCount || a.value.localeCompare(b.value)
    ));
  }, [catalogGenres, search, sort]);

  // Keep popularity sizing stable when search/sort changes: filtering should
  // move/hide pills, not make the remaining ones suddenly grow.
  const maxLog = useMemo(() => {
    if (catalogGenres.length === 0) return 1;
    return Math.log(Math.max(2, ...catalogGenres.map(genre => genre.albumCount)));
  }, [catalogGenres]);

  useEffect(() => {
    if (loading) return;
    const saved = readReturnState();
    if (!saved) return;
    sessionStorage.removeItem(RETURN_STATE_KEY);
    requestAnimationFrame(() => {
      const el = document.getElementById(APP_MAIN_SCROLL_VIEWPORT_ID);
      if (el) el.scrollTop = saved.scrollTop;
    });
  }, [loading]);

  const handleSortChange = (next: TagCatalogSort) => {
    setSort(next);
    sessionStorage.setItem(SORT_KEY, next);
  };

  const handleGenreClick = (genreValue: string) => {
    const el = document.getElementById(APP_MAIN_SCROLL_VIEWPORT_ID);
    sessionStorage.setItem(
      RETURN_STATE_KEY,
      JSON.stringify({
        search,
        scrollTop: el?.scrollTop ?? 0,
      } satisfies CatalogReturnState),
    );
    navigate(`/genres/${encodeURIComponent(genreValue)}`, { state: { returnTo: '/genres' } });
  };

  return (
    <div
      className="content-body animate-fade-in"
      data-benchmark-tag-catalog="genres"
      data-benchmark-result-count={genres.length}
    >
      <div className="psy-page-heading psy-page-heading--spaced">
        <h1 className="page-title truncate" title={t('genres.title')}>{t('genres.title')}</h1>
        {!loading && catalogGenres.length > 0 && (
          <span className="psy-page-heading__count">
            <span aria-hidden="true">–</span>
            {searchActive
              ? t('genres.filteredCount', { visible: genres.length, total: catalogGenres.length })
              : `${catalogGenres.length} ${t('genres.genreCount')}`}
          </span>
        )}
      </div>

      {!loading && catalogGenres.length > 0 && (
        <TagCatalogToolbar
          query={search}
          onQueryChange={setSearch}
          sort={sort}
          onSortChange={handleSortChange}
          searchPlaceholder={t('genres.searchPlaceholder')}
          searchAriaLabel={t('genres.searchLabel')}
          clearSearchLabel={t('genres.clearSearch')}
          sortAriaLabel={t('genres.sortLabel')}
          popularityLabel={t('genres.sortPopularity')}
          alphabeticalLabel={t('genres.sortAlphabetical')}
          benchmarkKind="genres"
        />
      )}

      {loading && <p className="loading-text">{t('genres.loading')}</p>}
      {!loading && catalogGenres.length === 0 && <p className="loading-text">{t('genres.empty')}</p>}
      {!loading && catalogGenres.length > 0 && genres.length === 0 && searchActive && (
        <p className="loading-text">{t('genres.noSearchResults', { query: search.trim() })}</p>
      )}

      {!loading && genres.length > 0 && (
        <div className="genre-cloud">
          {genres.map(genre => {
            const ratio = Math.log(Math.max(2, genre.albumCount)) / maxLog;
            const fontRem = FONT_MIN_REM + ratio * (FONT_MAX_REM - FONT_MIN_REM);
            const color = genreColor(genre.value);
            return (
              <button
                key={genre.value}
                type="button"
                className="genre-pill"
                style={{
                  '--genre-color': color,
                  fontSize: `${fontRem.toFixed(3)}rem`,
                } as React.CSSProperties}
                onClick={() => handleGenreClick(genre.value)}
                data-tooltip={t('genres.albumCount', { count: genre.albumCount })}
              >
                {genre.value}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
