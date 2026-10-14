import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';

import { APP_MAIN_SCROLL_VIEWPORT_ID } from '@/constants/appScroll';
import {
  libraryGetMoodAlbumCounts,
  type MoodAlbumCountRow,
} from '@/lib/api/library';
import { deriveLibraryBrowseIndexScopes } from '@/lib/library/libraryBrowseScope';
import { genreColor } from '@/lib/library/genreColor';
import { useAuthStore } from '@/store/authStore';
import { useLibrarySyncRevision } from '@/store/offlineLocalLibrarySyncRevision';
import TagCatalogToolbar, { type TagCatalogSort } from '@/ui/TagCatalogToolbar';

const RETURN_STATE_KEY = 'moods-return-state';
const SORT_KEY = 'moods-sort';

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

function mergeMoodCatalogs(
  catalogs: readonly MoodAlbumCountRow[][],
): MoodAlbumCountRow[] {
  const merged = new Map<string, MoodAlbumCountRow>();

  for (const catalog of catalogs) {
    for (const mood of catalog) {
      const value = mood.value.trim();
      if (!value) continue;

      const key = value.toLocaleLowerCase();
      const previous = merged.get(key);

      merged.set(key, {
        value: previous?.value ?? value,
        albumCount: (previous?.albumCount ?? 0) + mood.albumCount,
        songCount: (previous?.songCount ?? 0) + mood.songCount,
      });
    }
  }

  return [...merged.values()]
    .filter(mood => mood.albumCount > 0 || mood.songCount > 0)
    .sort(
      (a, b) =>
        b.albumCount - a.albumCount ||
        a.value.localeCompare(b.value),
    );
}

export default function Moods() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState(() => readReturnState()?.search ?? '');
  const [sort, setSort] = useState<TagCatalogSort>(readSort);

  const musicLibraryFilterVersion = useAuthStore(
    s => s.musicLibraryFilterVersion,
  );

  const libraryBrowseScopeVersion = useAuthStore(
    s => s.libraryBrowseScopeVersion,
  );

  const librarySyncRevision = useLibrarySyncRevision();

  const [rawMoods, setRawMoods] = useState<MoodAlbumCountRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const scopes = deriveLibraryBrowseIndexScopes(
      useAuthStore.getState(),
    );

    // React Compiler set-state-in-effect rule: loading is intentionally reset
    // when the active library scope or local index revision changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);

    void Promise.allSettled(
      scopes.map(scope =>
        libraryGetMoodAlbumCounts({
          serverId: scope.serverId,
          libraryScopes:
            scope.libraryIds.length > 0
              ? scope.libraryIds
              : undefined,
        }),
      ),
    )
      .then(results => {
        if (cancelled) return;

        const catalogs = results.flatMap(result =>
          result.status === 'fulfilled'
            ? [result.value]
            : [],
        );

        setRawMoods(mergeMoodCatalogs(catalogs));
      })
      .catch(() => {
        if (!cancelled) {
          setRawMoods([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    musicLibraryFilterVersion,
    libraryBrowseScopeVersion,
    librarySyncRevision,
  ]);

  const catalogMoods = rawMoods;
  const searchActive = search.trim().length > 0;

  const moods = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = query
      ? catalogMoods.filter(mood => mood.value.toLocaleLowerCase().includes(query))
      : [...catalogMoods];

    return filtered.sort((a, b) => (
      sort === 'alphabetical'
        ? a.value.localeCompare(b.value)
        : b.albumCount - a.albumCount || a.value.localeCompare(b.value)
    ));
  }, [catalogMoods, search, sort]);

  const maxLog = useMemo(() => {
    if (catalogMoods.length === 0) return 1;

    return Math.log(
      Math.max(2, ...catalogMoods.map(mood => mood.albumCount)),
    );
  }, [catalogMoods]);

  useEffect(() => {
    if (loading) return;

    const saved = readReturnState();
    if (!saved) return;

    sessionStorage.removeItem(RETURN_STATE_KEY);

    requestAnimationFrame(() => {
      const el = document.getElementById(
        APP_MAIN_SCROLL_VIEWPORT_ID,
      );

      if (el) {
        el.scrollTop = saved.scrollTop;
      }
    });
  }, [loading]);

  const handleSortChange = (next: TagCatalogSort) => {
    setSort(next);
    sessionStorage.setItem(SORT_KEY, next);
  };

  const handleMoodClick = (moodValue: string) => {
    const el = document.getElementById(
      APP_MAIN_SCROLL_VIEWPORT_ID,
    );

    sessionStorage.setItem(
      RETURN_STATE_KEY,
      JSON.stringify({
        search,
        scrollTop: el?.scrollTop ?? 0,
      } satisfies CatalogReturnState),
    );

    navigate(
      `/moods/${encodeURIComponent(moodValue)}`,
      {
        state: {
          returnTo: '/moods',
        },
      },
    );
  };

  return (
    <div
      className="content-body animate-fade-in"
      data-benchmark-tag-catalog="moods"
      data-benchmark-result-count={moods.length}
    >
      <div className="psy-page-heading psy-page-heading--spaced">
        <h1
          className="page-title truncate"
          title={t('moods.title', )}
        >
          {t('moods.title', )}
        </h1>

        {!loading && catalogMoods.length > 0 && (
          <span className="psy-page-heading__count">
            <span aria-hidden="true">–</span>

            {searchActive
              ? t('moods.filteredCount', { visible: moods.length, total: catalogMoods.length })
              : `${catalogMoods.length} ${t('moods.moodCount', { count: catalogMoods.length })}`}
          </span>
        )}
      </div>

      {!loading && catalogMoods.length > 0 && (
        <TagCatalogToolbar
          query={search}
          onQueryChange={setSearch}
          sort={sort}
          onSortChange={handleSortChange}
          searchPlaceholder={t('moods.searchPlaceholder')}
          searchAriaLabel={t('moods.searchLabel')}
          clearSearchLabel={t('moods.clearSearch')}
          sortAriaLabel={t('moods.sortLabel')}
          popularityLabel={t('moods.sortPopularity')}
          alphabeticalLabel={t('moods.sortAlphabetical')}
          benchmarkKind="moods"
        />
      )}

      {loading && (
        <p className="loading-text">
          {t('moods.loading', )}
        </p>
      )}

      {!loading && catalogMoods.length === 0 && (
        <p className="loading-text">
          {t('moods.empty', )}
        </p>
      )}

      {!loading && catalogMoods.length > 0 && moods.length === 0 && searchActive && (
        <p className="loading-text">
          {t('moods.noSearchResults', { query: search.trim() })}
        </p>
      )}

      {!loading && moods.length > 0 && (
        <div className="genre-cloud">
          {moods.map(mood => {
            const ratio =
              Math.log(Math.max(2, mood.albumCount)) /
              maxLog;

            const fontRem =
              FONT_MIN_REM +
              ratio * (FONT_MAX_REM - FONT_MIN_REM);

            // The existing genre palette helper is actually just a
            // deterministic string-to-colour hash, so it works for moods too.
            const color = genreColor(mood.value);

            return (
              <button
                key={mood.value}
                type="button"
                className="genre-pill"
                style={
                  {
                    '--genre-color': color,
                    fontSize: `${fontRem.toFixed(3)}rem`,
                  } as React.CSSProperties
                }
                onClick={() =>
                  handleMoodClick(mood.value)
                }
                data-tooltip={t('moods.albumCount', {
                  count: mood.albumCount,
                })}
              >
                {mood.value}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
