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

const SCROLL_KEY = 'moods-scroll';

const FONT_MIN_REM = 0.78;
const FONT_MAX_REM = 1.7;

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

  const moods = useMemo(
    () =>
      [...rawMoods].sort(
        (a, b) =>
          b.albumCount - a.albumCount ||
          a.value.localeCompare(b.value),
      ),
    [rawMoods],
  );

  const maxLog = useMemo(() => {
    if (moods.length === 0) return 1;

    return Math.log(
      Math.max(2, moods[0].albumCount),
    );
  }, [moods]);

  useEffect(() => {
    if (loading || moods.length === 0) return;

    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (!saved) return;

    const pos = parseInt(saved, 10);

    sessionStorage.removeItem(SCROLL_KEY);

    requestAnimationFrame(() => {
      const el = document.getElementById(
        APP_MAIN_SCROLL_VIEWPORT_ID,
      );

      if (el) {
        el.scrollTop = pos;
      }
    });
  }, [loading, moods.length]);

  const handleMoodClick = (moodValue: string) => {
    const el = document.getElementById(
      APP_MAIN_SCROLL_VIEWPORT_ID,
    );

    if (el) {
      sessionStorage.setItem(
        SCROLL_KEY,
        String(el.scrollTop),
      );
    }

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
    <div className="content-body animate-fade-in">
      <div className="psy-page-heading psy-page-heading--spaced">
        <h1
          className="page-title truncate"
          title={t('moods.title', )}
        >
          {t('moods.title', )}
        </h1>

        {!loading && moods.length > 0 && (
          <span className="psy-page-heading__count">
            <span aria-hidden="true">–</span>

            {moods.length}{' '}
            {t('moods.moodCount', )}
          </span>
        )}
      </div>

      {loading && (
        <p className="loading-text">
          {t('moods.loading', )}
        </p>
      )}

      {!loading && moods.length === 0 && (
        <p className="loading-text">
          {t('moods.empty', )}
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